"""Automation action coverage for room-native cleaning plans."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from functools import partial
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import probatio
import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, ServiceCall
from homeassistant.exceptions import (
    ServiceValidationError,
    Unauthorized,
    UnknownUser,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.plan_model as plan_model_module
from custom_components.matic_robot import daily_room_limit
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    QueueAction,
    UserCommand,
)
from custom_components.matic_robot.client.endpoints import HERMES_ENDPOINTS
from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    MaticError,
)
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    RobotActivity,
    Room,
)
from custom_components.matic_robot.const import (
    DATA_FIRMWARE_TRACKER,
    DOMAIN,
    MAX_ROOM_SEQUENCE_SIZE,
)
from custom_components.matic_robot.firmware import ANALYSIS_VERSION
from custom_components.matic_robot.managed_dispatch import (
    _async_mark_run_docked,
    _run_provenance,
)
from custom_components.matic_robot.managed_observation import (
    _async_wait_for_robot_activity,
)
from custom_components.matic_robot.managed_reconciliation import (
    _async_expire_native_reconciliation,
    _async_reconcile_native_stop,
    _native_completion_match,
    _schedule_native_reconciliation,
)
from custom_components.matic_robot.managed_run import (
    _NativeReconciliation,
)
from custom_components.matic_robot.plan_catalog import (
    MAX_SAVED_PLANS_PER_ROBOT,
    SavedPlanLimitError,
)
from custom_components.matic_robot.plan_model import (
    MANUAL_ROOM_SEQUENCE_PLAN_ID,
    CadenceBindingError,
    CleaningRoom,
    DuplicateRoomError,
    EmptyPlanError,
    PlanDisabledError,
    RoomSequenceLimitError,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.plan_repository import MetadataAdmissionClosedError
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.robot_commands import RobotCommands
from custom_components.matic_robot.robot_controls import RobotControls
from custom_components.matic_robot.room_sequence import (
    _resolve_room_id as _resolve_sequence_room_id,
)
from custom_components.matic_robot.room_sequence import (
    resolve_room_sequence,
)
from custom_components.matic_robot.service_context import (
    _entry_for_entity,
    _require_matic_control,
    _resolve_loaded_matic_vacuums,
    _saved_plan_context,
)
from custom_components.matic_robot.service_controls import (
    _ensure_stop_settled,
)
from custom_components.matic_robot.service_execution import (
    _async_execute_rooms,
)
from custom_components.matic_robot.service_plans import (
    _plan_cadence_bindings,
    _plan_request_error,
    _resolve_room_id,
)
from custom_components.matic_robot.service_schemas import (
    CLEAN_AREA_SERVICE_SCHEMA,
    CLEAN_ROOM_SEQUENCE_SCHEMA,
    CLEAN_SERVICE_SCHEMA,
    DELETE_ROOM_SCHEDULE_SCHEMA,
    PLAN_REFERENCE_SCHEMA,
    PREVIEW_ROOM_SEQUENCE_SCHEMA,
    ROOM_CADENCE_SCHEMA,
    RUN_SELECTED_PLAN_SCHEMA,
    SAVE_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
)
from custom_components.matic_robot.services import (
    async_register_services,
)
from custom_components.matic_robot.stores import LiveState, Store
from tests import legacy_bindings
from tests.session_fakes import FakeRobot, robot_client, robot_port, verifying_write


def test_room_sequence_default_resolver_uses_canonical_reference_rules() -> None:
    room_map = {"room-office": "Office"}

    assert _resolve_sequence_room_id(" ROOM-OFFICE ", room_map) == "room-office"
    with pytest.raises(ValueError, match="missing"):
        _resolve_sequence_room_id("missing", room_map)


def test_room_service_schemas_share_the_bounded_sequence_size() -> None:
    rooms = [
        {
            "room": f"Room {index}",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }
        for index in range(257)
    ]
    entity = {"entity_id": ["vacuum.test"]}
    for schema, payload in (
        (
            CLEAN_ROOM_SEQUENCE_SCHEMA,
            {**entity, "rooms": rooms[:MAX_ROOM_SEQUENCE_SIZE]},
        ),
        (
            PREVIEW_ROOM_SEQUENCE_SCHEMA,
            {**entity, "rooms": rooms[:MAX_ROOM_SEQUENCE_SIZE]},
        ),
    ):
        assert len(schema(payload)["rooms"]) == MAX_ROOM_SEQUENCE_SIZE
        with pytest.raises(probatio.Invalid):
            schema({**payload, "rooms": rooms[: MAX_ROOM_SEQUENCE_SIZE + 1]})

    save_payload = {
        **entity,
        "name": "Bounded",
        "rooms": rooms[:MAX_ROOM_SEQUENCE_SIZE],
    }
    assert len(SAVE_PLAN_SCHEMA(save_payload)["rooms"]) == MAX_ROOM_SEQUENCE_SIZE
    assert len(SAVE_PLAN_SCHEMA({**save_payload, "rooms": rooms[:101]})["rooms"]) == 101
    assert len(SAVE_PLAN_SCHEMA({**save_payload, "rooms": rooms[:256]})["rooms"]) == 256
    with pytest.raises(probatio.Invalid):
        SAVE_PLAN_SCHEMA({**save_payload, "rooms": rooms})

    clean_payload = {**entity, "rooms": [room["room"] for room in rooms]}
    assert (
        len(
            CLEAN_SERVICE_SCHEMA(
                {
                    **clean_payload,
                    "rooms": clean_payload["rooms"][:MAX_ROOM_SEQUENCE_SIZE],
                }
            )["rooms"]
        )
        == MAX_ROOM_SEQUENCE_SIZE
    )
    with pytest.raises(probatio.Invalid):
        CLEAN_SERVICE_SCHEMA(clean_payload)


def test_room_sequence_resolver_rejects_oversized_internal_requests() -> None:
    with pytest.raises(RoomSequenceLimitError, match="at most 100 rooms"):
        resolve_room_sequence(
            None,
            "serial",
            None,
            {},
            [{"room": str(index)} for index in range(MAX_ROOM_SEQUENCE_SIZE + 1)],
            entry_id="entry",
            return_to_base=True,
            use_room_schedule=False,
            override_room_schedule=False,
        )


async def test_run_provenance_and_docked_bridge_are_bounded(hass) -> None:
    """Automation/user context maps to labels and never stores identity."""
    automation = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {},
        context=Context(parent_id="parent", user_id="private-user"),
    )
    user = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {},
        context=Context(user_id="private-user"),
    )
    unknown = ServiceCall(hass, DOMAIN, "run_selected_plan", {}, context=Context())
    assert _run_provenance(automation) == "automation"
    assert _run_provenance(user) == "user"
    assert _run_provenance(unknown) == "external_unknown"

    manager = SimpleNamespace(
        ledger=SimpleNamespace(async_mark_run_docked=AsyncMock()),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    stop_fence_token = 19
    await _async_mark_run_docked(
        manager, "serial", None, "vacuum.matic", automation.context
    )
    manager.ledger.async_mark_run_docked.assert_not_awaited()
    await _async_mark_run_docked(
        manager,
        "serial",
        "run-1",
        "vacuum.matic",
        automation.context,
        stop_fence_token,
    )
    manager.ledger.async_mark_run_docked.assert_awaited_once_with(
        "serial",
        "run-1",
        entity_id="vacuum.matic",
        context=automation.context,
        stop_fence_token=stop_fence_token,
    )


@pytest.mark.parametrize("finish_requested", [False, True])
async def test_dock_upgrade_does_not_mask_unmanaged_running_failure(
    hass, finish_requested: bool
) -> None:
    """Only a managed stop may upgrade a still-running run at the dock."""
    finish_event = asyncio.Event()
    if finish_requested:
        finish_event.set()
    manager = SimpleNamespace(
        ledger=SimpleNamespace(async_mark_run_docked=AsyncMock()),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            finish_room_event=MagicMock(return_value=finish_event),
        ),
        history=SimpleNamespace(
            snapshot=MagicMock(
                return_value={"last_run": {"run_id": "run-1", "outcome": "running"}}
            )
        ),
    )

    await _async_mark_run_docked(manager, "serial", "run-1", "vacuum.matic", Context())

    manager.ledger.async_mark_run_docked.assert_not_awaited()


async def test_dock_upgrade_allows_managed_stop_running_failure(hass) -> None:
    """The managed STOP reason authorizes the early dock upgrade."""
    manager = SimpleNamespace(
        ledger=SimpleNamespace(async_mark_run_docked=AsyncMock()),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value="managed_stop"),
            finish_room_event=MagicMock(return_value=asyncio.Event()),
        ),
        history=SimpleNamespace(
            snapshot=MagicMock(
                return_value={"last_run": {"run_id": "run-1", "outcome": "running"}}
            )
        ),
    )

    await _async_mark_run_docked(manager, "serial", "run-1", "vacuum.matic", Context())

    manager.ledger.async_mark_run_docked.assert_awaited_once()


def _session(
    *,
    floor_plan: FloorPlan | None = None,
    info: object = SimpleNamespace(serial_number="serial"),
    refresh: object = None,
    confirm_room_completed: object = None,
    discard_current_room: object = None,
    robot: FakeRobot | None = None,
) -> SimpleNamespace:
    """Return the session parts the services read and ask.

    Its state is ``robot``'s, by default one that reports nothing.
    """
    robot = robot or FakeRobot()
    return SimpleNamespace(
        info=info,
        floor=Store(floor_plan),
        state=robot.state,
        error=robot.error,
        heartbeat=SimpleNamespace(
            async_request_refresh=refresh,
            async_confirm_room_completed=confirm_room_completed,
            async_discard_current_room=discard_current_room,
        ),
    )


def _registration(services, service: str) -> tuple:
    return next(
        item.args
        for item in services.async_register.call_args_list
        if item.args[1] == service
    )


def _registered_handler(services, service: str):
    """Return an action's handler; a robot action takes its vacuums from the call."""
    handler = _registration(services, service)[2]
    if not isinstance(handler, partial):
        return handler
    action = handler.args[2]
    return lambda call: action(
        [
            SimpleNamespace(entity_id=entity_id)
            for entity_id in cv.ensure_list(call.data.get("entity_id", []))
        ],
        call,
    )


def _area_floor_plan(
    *, mission_id: int = 42, partition_id: str = "synthetic-partition"
) -> FloorPlan:
    return FloorPlan(
        mission_id,
        partition_id,
        partition_id.encode(),
        (
            Room(
                "room-office",
                "Office",
                "protocol-office",
                b"office",
                ((0, 0), (4, 0), (4, 4), (0, 4)),
            ),
        ),
    )


async def _registered_services(hass, manager=None, *, is_running=False):
    services = SimpleNamespace(async_register=MagicMock(), async_call=AsyncMock())
    hass.services = services
    listen_once = MagicMock()
    original_bus = getattr(hass, "bus", None)
    hass.bus = SimpleNamespace(async_listen_once=listen_once)
    hass.is_running = is_running
    replacement = manager or SimpleNamespace(
        async_load=AsyncMock(), control=SimpleNamespace(stop_pending=lambda _s: False)
    )
    if manager is not None:
        replacement.async_load = AsyncMock()
    firmware = SimpleNamespace(
        async_load=AsyncMock(),
        occurrence_generation=MagicMock(return_value=0),
        async_record_snapshot=AsyncMock(
            return_value={"baseline": True, "changed_endpoints": []}
        ),
        async_configure_investigator=AsyncMock(),
        async_notification_action=AsyncMock(),
        replay_reports=MagicMock(),
    )
    with (
        patch(
            "custom_components.matic_robot.services.CleaningPlanManager",
            return_value=replacement,
        ),
        patch(
            "custom_components.matic_robot.services.FirmwareTracker",
            return_value=firmware,
        ),
    ):
        await async_register_services(hass)
    if original_bus is not None:
        hass.bus = original_bus
    hass.data[DOMAIN]["test_firmware_listen_once"] = listen_once
    return services


def _execution_call(hass) -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": False,
        },
    )


def test_room_management_reference_is_stable_and_fail_closed() -> None:
    assert (
        _resolve_room_id(
            "stable-bedroom",
            {
                "stable-bedroom": "Primary Bedroom",
                "other-room": "stable-bedroom",
            },
        )
        == "stable-bedroom"
    )

    with pytest.raises(ServiceValidationError, match="Ambiguous Matic room") as err:
        _resolve_room_id(
            "Bedroom",
            {
                "room-bedroom-east": "Bedroom",
                "room-bedroom-west": "BEDROOM",
            },
        )
    assert err.value.translation_key == "ambiguous_room"
    assert err.value.translation_placeholders == {"room": "Bedroom"}

    with pytest.raises(ServiceValidationError, match="Unknown Matic room"):
        _resolve_room_id("Missing", {"room-bedroom": "Bedroom"})


def _reachable_entry() -> SimpleNamespace:
    robot = FakeRobot()
    robot.show("docked")
    runtime = SimpleNamespace(session=_session(robot=robot), client=robot_client())
    return SimpleNamespace(runtime_data=runtime)


async def _route(hass, services, service: str, data: dict, method: str):
    """Run ``service`` on one reachable robot; return the call and its method."""
    call = ServiceCall(hass, DOMAIN, service, {"entity_id": ["vacuum.test"], **data})
    entry = _reachable_entry()
    sent = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
        patch.object(RobotControls, method, sent),
    ):
        await _registered_handler(services, service)(call)
    return call, sent


async def test_clean_action_routes_every_verified_preference() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    _call, sent = await _route(
        hass,
        services,
        "clean",
        {
            "rooms": ["Study", "Kitchen"],
            "cleaning_mode": "mop",
            "coverage_setting": "heavy_duty",
            "ordered": True,
        },
        "async_clean",
    )

    sent.assert_awaited_once_with(
        ["Study", "Kitchen"], cleaning_mode="mop", coverage="heavy_duty", ordered=True
    )
    services.async_call.assert_not_awaited()


async def test_go_to_room_action_sends_the_room() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    _call, sent = await _route(
        hass, services, "go_to_room", {"room": "Study"}, "async_go_to_room"
    )

    sent.assert_awaited_once_with("Study")
    services.async_call.assert_not_awaited()


@pytest.mark.parametrize(
    ("service", "data", "args", "options"),
    [
        ("skip_room", {}, (QueueAction.SKIP, "Study"), {}),
        ("clean_room_next", {}, (QueueAction.CLEAN_NEXT, "Study"), {}),
        (
            "clean_room_again",
            {},
            (QueueAction.CLEAN_AGAIN, "Study"),
            {"cleaning_mode": None, "coverage_setting": None},
        ),
        (
            "clean_room_again",
            {"cleaning_mode": "mop", "coverage_setting": "quick"},
            (QueueAction.CLEAN_AGAIN, "Study"),
            {
                "cleaning_mode": CleaningMode.MOP,
                "coverage_setting": CoverageSetting.QUICK,
            },
        ),
    ],
)
async def test_queue_actions_send_the_queue_change(
    service, data, args, options
) -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    _call, sent = await _route(
        hass, services, service, {"room": "Study", **data}, "async_change_queue"
    )

    sent.assert_awaited_once_with(*args, **options)
    services.async_call.assert_not_awaited()


async def test_clean_action_without_rooms_targets_entire_floor() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    _call, sent = await _route(
        hass, services, "clean", {"ordered": False}, "async_clean"
    )
    sent.assert_awaited_once_with(
        None, cleaning_mode=None, coverage=None, ordered=False
    )


async def test_clean_action_checks_oem_stop_fence() -> None:
    """The generic clean service cannot bypass a graceful OEM STOP."""
    hass = SimpleNamespace(data={})
    manager = SimpleNamespace(
        async_load=AsyncMock(),
        control=SimpleNamespace(stop_pending=MagicMock(return_value=False)),
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(info=SimpleNamespace(serial_number="serial")),
            client=robot_client(async_get_active_cleaning_session_state=AsyncMock()),
        )
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
    ):
        await _registered_handler(services, "clean")(call)

    manager.control.stop_pending.assert_called_once_with("serial")


async def test_clean_area_uses_only_private_saved_geometry(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    managed_token = manager.control.begin_managed_motion("serial")
    floor_plan = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"office": "Office"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "area": "Litter box",
                "coverage_setting": "heavy_duty",
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        result = await _registered_handler(services, "clean_area")(call)

    assert result is None
    assert call.data["area"] == "Litter box"
    assert "circles" not in call.data
    assert manager.control.managed_motion_is_current("serial", managed_token) is False
    client.async_start_custom_coverage.assert_awaited_once_with(
        floor_plan,
        [(1.0, 2.0, 0.35)],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.HEAVY_DUTY,
    )
    session.heartbeat.async_request_refresh.assert_awaited_once()


async def test_custom_area_native_completion_does_not_advance_shared_cadence(
    hass,
) -> None:
    """A room-like native record cannot credit cadence for an area command."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    _, identities = _plan_cadence_bindings(entry)
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 2,
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities=identities,
    )
    shared_progress = manager.repository.robot("serial")["shared_room_cadence"][
        room.id
    ]["progress"]
    shared_progress.update(mop=1, coverage=1)
    progress_before = deepcopy(shared_progress)

    await manager.catalog.async_save_area(
        "serial",
        "office-area",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Office area",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA(
            {"entity_id": ["vacuum.test"], "area": "Office area"}
        ),
    )
    context = ("vacuum.test", entry, "serial", {room.id: room.name})
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "clean_area")(call)

    client.async_start_custom_coverage.assert_awaited_once()
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False

    # A synthetic native session can report the mapped room as completed. The
    # importer records the opportunity, but without a managed dispatch marker
    # it must not treat that evidence as shared-schedule completion.
    ended_at = dt_util.utcnow().isoformat()
    native_record = CleaningSessionRecord(
        b"synthetic-area-completion",
        CleaningSession(
            (dt_util.utcnow() - timedelta(seconds=30)).isoformat(),
            ended_at,
            30,
            (room.name,),
            ((room.name, 30),),
            True,
            completed_rooms=(room.name,),
        ),
    )
    assert await manager.ledger.async_import_native_history(
        "serial", floor_plan, (native_record,)
    )
    assert (
        manager.repository.robot("serial")["rooms"][room.id]["last_opportunity"]
        == ended_at
    )
    assert (
        manager.repository.robot("serial")["shared_room_cadence"][room.id]["progress"]
        == progress_before
    )


async def test_clean_area_reports_unknown_invalid_and_missing_map(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "broken",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Broken",
            "circles": [{}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    await manager.catalog.async_save_area(
        "serial",
        "invalid_settings",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Invalid settings",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    await manager.catalog.async_save_area(
        "serial",
        "non_string_settings",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Non-string settings",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": 5,
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    services = await _registered_services(hass, manager)
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=robot_client(
                async_start_custom_coverage=AsyncMock(),
                async_get_active_cleaning_session_state=AsyncMock(return_value=False),
            ),
            session=session,
        )
    )
    context = ("vacuum.test", entry, "serial", {"office": "Office"})

    async def invoke(area: str) -> None:
        call = ServiceCall(
            hass,
            DOMAIN,
            "clean_area",
            CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": area}),
        )
        await _registered_handler(services, "clean_area")(call)

    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError) as unknown:
            await invoke("Missing")
        assert unknown.value.translation_key == "unknown_area"
        with pytest.raises(ServiceValidationError) as invalid:
            await invoke("Broken")
        assert invalid.value.translation_key == "invalid_area"
        with pytest.raises(ServiceValidationError) as invalid_settings:
            await invoke("Invalid settings")
        assert invalid_settings.value.translation_key == "invalid_area"
        with pytest.raises(ServiceValidationError) as non_string_settings:
            await invoke("Non-string settings")
        assert non_string_settings.value.translation_key == "invalid_area"
        session.floor.value = None
        with pytest.raises(ServiceValidationError) as no_map:
            await invoke("Broken")
        assert no_map.value.translation_key == "room_plan_unavailable"


@pytest.mark.parametrize(
    "mismatch", ["legacy", "invalid", "mission", "partition", "geometry"]
)
async def test_clean_area_blocks_every_stale_map_binding_before_robot_command(
    hass, mismatch
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    saved_floor_plan = _area_floor_plan()
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Litter box",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": legacy_bindings.v1(saved_floor_plan),
    }
    if mismatch == "legacy":
        area.pop("schema_version")
        area.pop("map_binding")
        live_floor_plan = saved_floor_plan
    elif mismatch == "invalid":
        area["schema_version"] = AREA_SCHEMA_VERSION + 1
        live_floor_plan = saved_floor_plan
    elif mismatch == "mission":
        live_floor_plan = _area_floor_plan(mission_id=43)
    elif mismatch == "partition":
        live_floor_plan = _area_floor_plan(partition_id="new-partition")
        # A changed partition with identical geometry preserves coordinates.
        # Keep this blocked-command case spatially different as well.
        room = live_floor_plan.rooms[0]
        live_floor_plan = replace(
            live_floor_plan,
            rooms=(replace(room, boundary=((0.05, 0), *room.boundary[1:])),),
        )
    else:
        room = saved_floor_plan.rooms[0]
        live_floor_plan = FloorPlan(
            saved_floor_plan.mission_id,
            saved_floor_plan.partition_protocol_id,
            saved_floor_plan.partition_id_wire,
            (
                Room(
                    room.id,
                    room.name,
                    room.protocol_id,
                    room.id_wire,
                    ((0.01, 0), *room.boundary[1:]),
                ),
            ),
        )
    await manager.catalog.async_save_area("serial", "litter_box", area)
    managed_token = manager.control.begin_managed_motion("serial")
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    session = _session(floor_plan=live_floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
        ),
        pytest.raises(ServiceValidationError) as stale,
    ):
        await _registered_handler(services, "clean_area")(call)

    assert stale.value.translation_key == "area_map_changed"
    assert manager.control.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()

    session.heartbeat.async_request_refresh.assert_not_awaited()


async def test_clean_area_rechecks_floor_plan_after_motion_lock_wait(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    managed_token = manager.control.begin_managed_motion("serial")
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    lock = manager.control.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        session.floor.value = _area_floor_plan(mission_id=43)
        lock.release()
        with pytest.raises(ServiceValidationError) as stale:
            await task

    assert stale.value.translation_key == "area_map_changed"
    assert manager.control.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()

    session.floor.value = floor_plan
    lock = manager.control.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
        lock.release()
        with pytest.raises(ServiceValidationError) as transitioning:
            await task

    assert transitioning.value.translation_key == "room_plan_unavailable"
    assert manager.control.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
    replace_started = asyncio.Event()
    release_replace = asyncio.Event()
    original_persist = manager.control.async_persist_reconciliation_removal

    async def delayed_persist(serial_number: str, removed: bool) -> None:
        replace_started.set()
        await release_replace.wait()
        await original_persist(serial_number, removed)

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
        ),
        patch.object(
            manager.control,
            "async_persist_reconciliation_removal",
            side_effect=delayed_persist,
        ),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await replace_started.wait()
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
        release_replace.set()
        with pytest.raises(ServiceValidationError) as changed_during_replace:
            await task

    assert changed_during_replace.value.translation_key == "room_plan_unavailable"
    assert manager.control.managed_motion_is_current("serial", managed_token) is False
    client.async_start_custom_coverage.assert_not_awaited()

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
    managed_token = manager.control.begin_managed_motion("serial")
    lock = manager.control.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        await manager.catalog.async_delete_area("serial", "litter_box")
        lock.release()
        with pytest.raises(ServiceValidationError) as deleted:
            await task

    assert deleted.value.translation_key == "unknown_area"
    assert manager.control.managed_motion_is_current("serial", managed_token) is True


async def test_clean_area_rechecks_stop_fence_after_motion_lock_wait(hass) -> None:
    """A STOP queued first fences a custom-area clean waiting on its lock."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    managed_token = manager.control.begin_managed_motion("serial")
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    lock = manager.control.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        manager.control.mark_stop_pending("serial")
        lock.release()
        with pytest.raises(ServiceValidationError) as blocked:
            await task

    assert blocked.value.translation_key == "robot_stop_pending"
    assert manager.control.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()
    session.heartbeat.async_request_refresh.assert_not_awaited()


async def test_after_room_stop_supersedes_custom_area_queued_for_command_lock(
    hass,
) -> None:
    """A custom-area request queued before graceful Stop cannot replace its run."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor),
        },
    )
    room = CleaningRoom("room-2", "Study", "vacuum", "quick")
    managed_token = manager.control.begin_managed_motion("serial")
    await manager.ledger.async_begin_run(
        "serial",
        "plan",
        "run-id",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=True,
        finish_current_room_threshold=0,
    )
    await manager.ledger.async_mark_started("serial", "plan", room, run_id="run-id")
    plan_lock = manager.control.lock("serial")
    await plan_lock.acquire()
    command_lock = manager.control.command_lock("serial")
    await command_lock.acquire()
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    session = _session(floor_plan=floor, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        try:
            for _ in range(30):
                waiters = getattr(command_lock, "_waiters", None)
                if waiters is not None and any(not waiter.done() for waiter in waiters):
                    break
                await asyncio.sleep(0)
            else:
                pytest.fail("Custom-area clean never queued for the command lock")

            decision = manager.control.request_stop("serial")
            assert decision.behavior == "after_room"
            assert manager.control.finish_room_event("serial").is_set()
            assert not manager.control.cancellation_event("serial").is_set()

            command_lock.release()
            with pytest.raises(ServiceValidationError, match="superseded"):
                await task

            assert manager.control.managed_motion_is_current("serial", managed_token)
            client.async_start_custom_coverage.assert_not_awaited()
            session.heartbeat.async_request_refresh.assert_not_awaited()
        finally:
            if command_lock.locked():
                command_lock.release()
            if plan_lock.locked():
                plan_lock.release()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


async def test_stop_service_immediately_stops_after_owner_replacement(hass) -> None:
    """A Stop after replacement must not honor a stale plan's after-room rule."""
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    serial_number = "synthetic-serial"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    run_id = "run-id"
    token = manager.control.begin_managed_motion(serial_number)
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        run_id,
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=True,
        finish_current_room_threshold=0,
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("room-2", "Study", "vacuum", "quick"),
        run_id=run_id,
    )
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    services = await _registered_services(hass, manager)
    entry = entity_entry()
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum_platform.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.test"
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    command_lock = manager.control.command_lock(serial_number)
    await command_lock.acquire()
    persistence_started = asyncio.Event()
    release_persistence = asyncio.Event()

    async def persist_replacement(*_args) -> None:
        persistence_started.set()
        await release_persistence.wait()

    async def route_return_to_base(domain, service, data, **kwargs) -> None:
        assert (domain, service, data) == (
            "vacuum",
            "return_to_base",
            {"entity_id": "vacuum.test"},
        )
        dispatch = manager.control.managed_stop_dispatch_transaction.get()
        assert dispatch is not None and dispatch[0] == serial_number
        assert kwargs["blocking"] is True
        assert kwargs["context"] is stop.context
        await asyncio.create_task(entity.async_return_to_base())

    with (
        patch.object(
            manager.control,
            "async_persist_reconciliation_removal",
            side_effect=persist_replacement,
        ),
        patch.object(
            manager.control, "request_stop", wraps=manager.control.request_stop
        ) as request,
        patch.object(RobotCommands, "schedule_dock_after_stop"),
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, serial_number, {}),
        ),
    ):
        services.async_call.side_effect = route_return_to_base
        replacement = asyncio.create_task(
            manager.control.async_replace_managed_motion(serial_number)
        )
        stop_task = None
        try:
            await persistence_started.wait()
            stop_task = asyncio.create_task(
                _registered_handler(services, "stop_intelligent_cleaning")(stop)
            )
            for _ in range(30):
                waiters = getattr(command_lock, "_waiters", None)
                if waiters is not None and any(not waiter.done() for waiter in waiters):
                    break
                await asyncio.sleep(0)
            else:
                pytest.fail("Stop service never queued behind motion persistence")

            request.assert_not_called()
            release_persistence.set()
            await replacement
            command_lock.release()
            await stop_task

            request.assert_called_once_with(serial_number)
            assert not manager.control.managed_motion_is_current(serial_number, token)
            assert (
                manager.control.cancellation_reason(serial_number) == "motion_replaced"
            )
            assert not manager.control.finish_room_event(serial_number).is_set()
            assert manager.control.cancellation_event(serial_number).is_set()
            services.async_call.assert_awaited_once_with(
                "vacuum",
                "return_to_base",
                {"entity_id": "vacuum.test"},
                blocking=True,
                context=stop.context,
            )
            entry.runtime_data.session.client.async_send_user_command.assert_awaited_once_with(
                UserCommand.STOP
            )
        finally:
            release_persistence.set()
            if command_lock.locked():
                command_lock.release()
            if plan_lock.locked():
                plan_lock.release()
            for task in (replacement, stop_task):
                if task is not None and not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)


async def test_stop_service_preserves_managed_stop_reason_for_return_to_base(
    hass,
) -> None:
    """The Stop service keeps its reason across HA's nested service task."""
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    serial_number = "synthetic-serial"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        serial_number,
        "plan",
        {
            "name": "Plan",
            "enabled": True,
            "finish_current_room": False,
            "rooms": [],
        },
    )
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        "run-id",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=False,
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("room-2", "Study", "vacuum", "quick"),
        run_id="run-id",
    )
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    services = await _registered_services(hass, manager)
    entry = entity_entry()
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum_platform.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.test"
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )

    async def route_return_to_base(_domain, _service, _data, **_kwargs) -> None:
        await asyncio.create_task(entity.async_return_to_base())

    try:
        with (
            patch.object(RobotCommands, "schedule_dock_after_stop"),
            patch(
                "custom_components.matic_robot.service_context._saved_plan_context",
                return_value=("vacuum.test", entry, serial_number, {}),
            ),
        ):
            services.async_call.side_effect = route_return_to_base
            await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    finally:
        if plan_lock.locked():
            plan_lock.release()

    assert manager.control.cancellation_reason(serial_number) == "managed_stop"
    entry.runtime_data.session.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


async def test_stop_service_return_to_base_does_not_stop_replacement_motion(
    hass,
) -> None:
    """A delayed Stop Return Home cannot stop motion admitted after its request."""
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    serial_number = "synthetic-serial"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        serial_number,
        "plan",
        {
            "name": "Plan",
            "enabled": True,
            "finish_current_room": False,
            "rooms": [],
        },
    )
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        "run-id",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=False,
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("room-2", "Study", "vacuum", "quick"),
        run_id="run-id",
    )
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    # A direct replacement is admitted after Stop records its request, while
    # the nested Return Home service is deliberately paused.
    services = await _registered_services(hass, manager)
    entry = entity_entry()
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum_platform.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.test"
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    nested_service_started = asyncio.Event()
    release_nested_service = asyncio.Event()

    async def route_return_to_base(_domain, _service, _data, **_kwargs) -> None:
        nested_service_started.set()
        await release_nested_service.wait()
        await asyncio.create_task(entity.async_return_to_base())

    with (
        patch.object(RobotCommands, "schedule_dock_after_stop"),
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, serial_number, {}),
        ),
    ):
        services.async_call.side_effect = route_return_to_base
        stop_task = asyncio.create_task(
            _registered_handler(services, "stop_intelligent_cleaning")(stop)
        )
        try:
            await asyncio.wait_for(nested_service_started.wait(), timeout=1)
            await entity._commands.async_clean(["Study"])
            replacement_generation = manager.control.motion_generation(serial_number)
            release_nested_service.set()
            await stop_task
        finally:
            release_nested_service.set()
            if not stop_task.done():
                stop_task.cancel()
                await asyncio.gather(stop_task, return_exceptions=True)
            if plan_lock.locked():
                plan_lock.release()

    assert manager.control.motion_generation(serial_number) == replacement_generation
    assert manager.control.cancellation_reason(serial_number) == "motion_replaced"
    entry.runtime_data.session.client.async_start_coverage.assert_awaited_once()
    entry.runtime_data.session.client.async_send_user_command.assert_not_awaited()


async def test_stop_service_blocks_resume_until_stop_dispatch(hass) -> None:
    """A paused task cannot resume between Stop acceptance and physical STOP."""
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    serial_number = "synthetic-serial"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        serial_number,
        "plan",
        {
            "name": "Plan",
            "enabled": True,
            "finish_current_room": False,
            "rooms": [],
        },
    )
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        "run-id",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=False,
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("room-2", "Study", "vacuum", "quick"),
        run_id="run-id",
    )
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    services = await _registered_services(hass, manager)
    entry = entity_entry(paused=True)
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum_platform.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.test"
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    dispatch_started = asyncio.Event()
    release_dispatch = asyncio.Event()

    async def route_return_to_base(_domain, _service, _data, **_kwargs) -> None:
        dispatch_started.set()
        await release_dispatch.wait()
        await asyncio.create_task(entity.async_return_to_base())

    try:
        with (
            patch.object(RobotCommands, "schedule_dock_after_stop"),
            patch(
                "custom_components.matic_robot.service_context._saved_plan_context",
                return_value=("vacuum.test", entry, serial_number, {}),
            ),
        ):
            services.async_call.side_effect = route_return_to_base
            stop_task = asyncio.create_task(
                _registered_handler(services, "stop_intelligent_cleaning")(stop)
            )
            try:
                await asyncio.wait_for(dispatch_started.wait(), timeout=1)
                assert manager.control.stop_dispatch_pending(serial_number)
                with pytest.raises(ServiceValidationError) as error:
                    await entity.async_start()
                assert error.value.translation_key == "robot_stop_pending"
                release_dispatch.set()
                await stop_task
            finally:
                release_dispatch.set()
                if not stop_task.done():
                    stop_task.cancel()
                    await asyncio.gather(stop_task, return_exceptions=True)
    finally:
        if plan_lock.locked():
            plan_lock.release()

    assert not manager.control.stop_dispatch_pending(serial_number)
    entry.runtime_data.session.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


async def test_stale_stop_does_not_discard_replacement_room_tracking(hass) -> None:
    """The Stop tracker discard must not cross a replacement generation."""
    from custom_components.matic_robot import vacuum as vacuum_platform
    from custom_components.matic_robot.session_tracking import CleaningSessionTracker
    from tests.test_entities import _entry as entity_entry

    serial_number = "synthetic-serial"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        serial_number,
        "plan",
        {
            "name": "Plan",
            "enabled": True,
            "finish_current_room": False,
            "rooms": [],
        },
    )
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        "run-id",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=False,
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("room-2", "Study", "vacuum", "quick"),
        run_id="run-id",
    )
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    services = await _registered_services(hass, manager)
    entry = entity_entry()
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum_platform.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.test"
    tracker = CleaningSessionTracker()
    entry.runtime_data.session.heartbeat.async_discard_current_room = lambda: (
        tracker.discard_current_room(now=dt_util.utcnow())
    )
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    stop_lock_released = asyncio.Event()
    replacement_started = asyncio.Event()
    original_external_command = manager.control.external_command

    @asynccontextmanager
    async def release_stop_lock_for_replacement(serial: str):
        async with original_external_command(serial):
            yield
        stop_lock_released.set()
        await replacement_started.wait()

    async def route_return_to_base(_domain, _service, _data, **_kwargs) -> None:
        await asyncio.create_task(entity.async_return_to_base())

    with (
        patch.object(
            manager.control, "external_command", release_stop_lock_for_replacement
        ),
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, serial_number, {}),
        ),
    ):
        services.async_call.side_effect = route_return_to_base
        stop_task = asyncio.create_task(
            _registered_handler(services, "stop_intelligent_cleaning")(stop)
        )
        try:
            await asyncio.wait_for(stop_lock_released.wait(), timeout=1)
            await entity._commands.async_clean(["Study"])
            tracker.update(
                cleaning=True,
                current_area="Study",
                room_names=("Study",),
                now=dt_util.utcnow(),
            )
            tracker.confirm_room_completed("Study")
            replacement_started.set()
            await stop_task
        finally:
            replacement_started.set()
            if not stop_task.done():
                stop_task.cancel()
                await asyncio.gather(stop_task, return_exceptions=True)
            if plan_lock.locked():
                plan_lock.release()

    assert manager.control.cancellation_reason(serial_number) == "motion_replaced"
    assert tracker._current_room == "Study"
    assert tracker._active_started_at is not None
    assert tracker._confirmed_rooms == {"Study"}
    entry.runtime_data.session.client.async_start_coverage.assert_awaited_once()
    entry.runtime_data.session.client.async_send_user_command.assert_not_awaited()


async def test_clean_area_translates_client_failure_without_protocol_details(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": legacy_bindings.v1(floor_plan),
        },
    )
    client = robot_client(
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
        async_start_custom_coverage=AsyncMock(
            side_effect=MaticError("synthetic protocol detail")
        ),
    )
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _registered_handler(services, "clean_area")(call)

    assert failure.value.translation_key == "robot_command_failed"
    assert "protocol detail" not in str(failure.value)
    session.heartbeat.async_request_refresh.assert_not_awaited()


async def test_clean_room_sequence_preserves_order_and_per_room_settings(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room("room-office", "Office", "office", b"office", ()),
            Room("room-study", "Study", "study", b"study", ()),
        ),
    )
    session = _session(
        floor_plan=floor_plan, refresh=AsyncMock(), confirm_room_completed=MagicMock()
    )
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            session=session,
            client=robot_client(
                async_get_active_cleaning_session_state=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(
                    return_value=b"native-task"
                ),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "rooms": [
                    {
                        "room": "Study",
                        "cleaning_mode": "mop",
                        "coverage_setting": "heavy_duty",
                    },
                    {
                        "room": "Office",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    },
                ],
            }
        ),
    )
    # Existing room-sequence callers keep their saved per-room settings unless
    # they explicitly opt into shared cadence.
    assert call.data["use_room_schedule"] is False

    async def exercise_sequence(*_args, **kwargs) -> None:
        assert kwargs["floor_is_current"]() is True
        original_floor = session.floor.value
        session.floor.value = replace(
            original_floor,
            rooms=tuple(
                replace(room, name="The Study") for room in original_floor.rooms
            ),
        )
        assert kwargs["floor_is_current"]() is False
        session.floor.value = original_floor
        token = manager.control.begin_managed_motion("serial")
        try:
            await kwargs["managed_user_command"](token, UserCommand.STOP)
        finally:
            manager.control.end_managed_motion("serial", token)

    execute = AsyncMock(side_effect=exercise_sequence)
    dock_after_stop = MagicMock()
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=(
                "vacuum.test",
                entry,
                "serial",
                {"room-office": "Office", "room-study": "Study"},
            ),
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute,
        ),
        patch(
            "custom_components.matic_robot.managed_dispatch.schedule_dock_after_stop",
            dock_after_stop,
        ),
    ):
        await _registered_handler(services, "clean_room_sequence")(call)

    rooms = execute.await_args.args[5]
    assert rooms == [
        CleaningRoom("room-study", "Study", "mop", "heavy_duty"),
        CleaningRoom("room-office", "Office", "vacuum", "standard"),
    ]
    assert "intelligent" not in execute.await_args.kwargs
    assert execute.await_args.args[1].data["plan_id"] == MANUAL_ROOM_SEQUENCE_PLAN_ID
    assert execute.await_args.args[1].data["return_to_base"] is True
    assert execute.await_args.kwargs["floor_token"] == plan_floor_token(floor_plan)
    entry.runtime_data.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )
    session.heartbeat.async_request_refresh.assert_awaited_once_with()
    dock_after_stop.assert_called_once()


async def test_preview_room_sequence_matches_dispatch_and_rejects_stale_token(
    hass,
) -> None:
    hass.auth = SimpleNamespace(
        async_get_user=AsyncMock(return_value=SimpleNamespace(is_admin=True))
    )
    admin_context = Context(user_id="preview-admin")
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    second_room = Room(
        "room-study",
        "Study",
        "protocol-study",
        b"study",
        ((5, 0), (9, 0), (9, 4), (5, 4)),
    )
    floor_plan = replace(floor_plan, rooms=(room, second_room))
    identity = _plan_cadence_bindings(
        SimpleNamespace(
            runtime_data=SimpleNamespace(
                session=_session(floor_plan=floor_plan),
                slam_map=SimpleNamespace(
                    floor_plan_is_current=MagicMock(return_value=True)
                ),
            )
        )
    )[1][room.id]
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 2,
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    schedule = manager.repository.robot("serial")["shared_room_cadence"][room.id]
    schedule["progress"] = {"mop": 1, "coverage": 1}
    entry = SimpleNamespace(
        entry_id="entry-preview",
        runtime_data=SimpleNamespace(
            session=_session(
                floor_plan=floor_plan,
                refresh=AsyncMock(),
                confirm_room_completed=MagicMock(),
            ),
            client=robot_client(
                async_get_active_cleaning_session_state=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(return_value=b"native"),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    services = await _registered_services(hass, manager)
    input_data = {
        "entity_id": ["vacuum.test"],
        "rooms": [
            {
                "room": room.id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
            {
                "room": second_room.id,
                "cleaning_mode": "mop",
                "coverage_setting": "heavy_duty",
            },
        ],
        "use_room_schedule": True,
    }
    preview_call = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        PREVIEW_ROOM_SEQUENCE_SCHEMA(input_data),
        context=admin_context,
    )
    context = (
        "vacuum.test",
        entry,
        "serial",
        {room.id: room.name, second_room.id: second_room.name},
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        preview = await _registered_handler(services, "preview_room_sequence")(
            preview_call
        )

    assert len(preview["preview_token"]) == 64
    assert preview["rooms"][0]["cleaning_mode"] == "vacuum_and_mop"
    assert preview["rooms"][0]["cadence_reasons"] == ["mop_due", "coverage_due"]
    assert preview["rooms"][0]["coverage_setting"] == "quick"
    assert [item["room_id"] for item in preview["rooms"]] == [
        room.id,
        second_room.id,
    ]
    assert preview["rooms"][1]["cleaning_mode"] == "mop"

    async def execute_sequence(*_args, **kwargs) -> None:
        # The managed executor invokes this after its stop/checkpoint awaits;
        # keep the service regression at the same TOCTOU boundary.
        kwargs["validate_prepared_run"]()

    execute = AsyncMock(side_effect=execute_sequence)
    dispatch_data = {**input_data, "preview_token": preview["preview_token"]}
    dispatch_call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(dispatch_data),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute,
        ),
    ):
        await _registered_handler(services, "clean_room_sequence")(dispatch_call)
    assert (
        execute.await_args.args[5][0].cleaning_mode
        == preview["rooms"][0]["cleaning_mode"]
    )
    assert (
        execute.await_args.args[5][0].coverage_setting
        == preview["rooms"][0]["coverage_setting"]
    )
    assert [item.room_id for item in execute.await_args.args[5]] == [
        room.id,
        second_room.id,
    ]

    duplicate_input = {
        "entity_id": ["vacuum.test"],
        "rooms": [
            {
                "room": room.id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
            {
                "room": room.name,
                "cleaning_mode": "mop",
                "coverage_setting": "heavy_duty",
            },
        ],
    }
    for duplicate_data in (
        duplicate_input,
        {**duplicate_input, "use_room_schedule": True},
    ):
        duplicate_preview_call = ServiceCall(
            hass,
            DOMAIN,
            "preview_room_sequence",
            PREVIEW_ROOM_SEQUENCE_SCHEMA(duplicate_data),
            context=admin_context,
        )
        with (
            patch(
                "custom_components.matic_robot.service_context._saved_plan_context",
                return_value=context,
            ),
            pytest.raises(ServiceValidationError, match="more than once"),
        ):
            await _registered_handler(services, "preview_room_sequence")(
                duplicate_preview_call
            )

        duplicate_dispatch = ServiceCall(
            hass,
            DOMAIN,
            "clean_room_sequence",
            CLEAN_ROOM_SEQUENCE_SCHEMA(duplicate_data),
        )
        execute.reset_mock()
        with (
            patch(
                "custom_components.matic_robot.service_context._saved_plan_context",
                return_value=context,
            ),
            patch(
                "custom_components.matic_robot.service_execution._async_execute_rooms",
                execute,
            ),
            pytest.raises(ServiceValidationError, match="more than once"),
        ):
            await _registered_handler(services, "clean_room_sequence")(
                duplicate_dispatch
            )
        execute.assert_not_awaited()

    async def mutate_before_dispatch(*_args, **kwargs) -> None:
        schedule["progress"] = {"mop": 0, "coverage": 0}
        schedule["policy"]["do_mop_next"] = True
        kwargs["validate_prepared_run"]()

    execute_with_mutation = AsyncMock(side_effect=mutate_before_dispatch)
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute_with_mutation,
        ),
        pytest.raises(ServiceValidationError, match="resolution changed") as raised,
    ):
        await _registered_handler(services, "clean_room_sequence")(dispatch_call)
    execute_with_mutation.assert_awaited_once()
    assert raised.value.translation_key == "room_sequence_preview_changed"

    schedule["progress"] = {"mop": 1, "coverage": 1}
    schedule["policy"]["do_mop_next"] = False
    schedule["identity"] = identity

    async def invalidate_identity(*_args, **kwargs) -> None:
        schedule["identity"] = "0" * 64
        kwargs["validate_prepared_run"]()

    execute_with_invalid_map = AsyncMock(side_effect=invalidate_identity)
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute_with_invalid_map,
        ),
        pytest.raises(ServiceValidationError) as invalid_map,
    ):
        await _registered_handler(services, "clean_room_sequence")(dispatch_call)
    assert invalid_map.value.translation_key == "invalid_plan"
    assert "different map" in str(invalid_map.value.__cause__)
    execute_with_invalid_map.assert_awaited_once()

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as invalid_preview,
    ):
        await _registered_handler(services, "preview_room_sequence")(preview_call)
    assert invalid_preview.value.translation_key == "invalid_plan"

    schedule["identity"] = identity
    schedule["progress"] = {"mop": 0, "coverage": 0}
    schedule["policy"]["do_mop_next"] = True
    stale_call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(dispatch_data),
    )
    execute.reset_mock()
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError, match="preview is stale") as raised,
    ):
        await _registered_handler(services, "clean_room_sequence")(stale_call)
    execute.assert_not_awaited()
    assert raised.value.translation_key == "room_sequence_preview_changed"


async def test_preview_room_sequence_requires_administrator(hass) -> None:
    hass.auth = SimpleNamespace(
        async_get_user=AsyncMock(return_value=SimpleNamespace(is_admin=False))
    )
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        PREVIEW_ROOM_SEQUENCE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "rooms": [
                    {
                        "room": "room-office",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    }
                ],
            }
        ),
        context=Context(user_id="restricted-user"),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        pytest.raises(Unauthorized),
    ):
        await _registered_handler(services, "preview_room_sequence")(call)

    hass.auth.async_get_user.return_value = None
    with pytest.raises(UnknownUser):
        await _registered_handler(services, "preview_room_sequence")(call)

    anonymous_call = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        call.data,
        context=Context(),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        pytest.raises(Unauthorized),
    ):
        await _registered_handler(services, "preview_room_sequence")(anonymous_call)


@pytest.mark.parametrize(
    ("use_room_schedule", "override_room_schedule"),
    [(False, False), (True, False), (True, True)],
)
@pytest.mark.parametrize("requested_mode", ["vacuum", "vacuum_and_mop", "mop"])
async def test_clean_room_sequence_schedule_selection_controls_shared_accounting(
    hass, use_room_schedule, override_room_schedule, requested_mode
) -> None:
    """Only a manual run using the room schedule may advance shared progress."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    identity = _plan_cadence_bindings(
        SimpleNamespace(
            runtime_data=SimpleNamespace(
                session=_session(floor_plan=floor_plan),
                slam_map=SimpleNamespace(
                    floor_plan_is_current=MagicMock(return_value=True)
                ),
            )
        )
    )[1][room.id]
    await manager.catalog.async_save_plan(
        "serial",
        "quick_clean",
        {
            "name": "Quick Clean",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 1},
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    private_room_progress = (
        manager.repository.robot("serial")["plan_room_cadence"]
        .setdefault("quick_clean", {})
        .setdefault(
            room.id,
            {"identity": identity, "progress": {"mop": 0, "coverage": 0}},
        )
    )
    private_progress = private_room_progress["progress"]
    private_progress_before = deepcopy(private_progress)
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 2,
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    # Preserve this pre-existing legacy plan while exercising manual-run IDs.
    manager.repository.robot("serial")["plans"][MANUAL_ROOM_SEQUENCE_PLAN_ID] = {
        "name": "Legacy saved plan",
        "rooms": [],
    }
    await manager.catalog.async_save_plan(
        "serial",
        MANUAL_ROOM_SEQUENCE_PLAN_ID,
        {"name": "Legacy saved plan", "rooms": []},
        select=False,
    )
    manager.repository.robot("serial")["shared_room_cadence"][room.id]["progress"] = {
        "mop": 1,
        "coverage": 1,
    }
    session = _session(
        floor_plan=floor_plan, refresh=AsyncMock(), confirm_room_completed=MagicMock()
    )
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            session=session,
            client=robot_client(
                async_get_active_cleaning_session_state=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(return_value=b"native"),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    services = await _registered_services(hass, manager)
    service_data = {
        "entity_id": ["vacuum.test"],
        "rooms": [
            {
                "room": room.id,
                "cleaning_mode": requested_mode,
                "coverage_setting": "standard",
            }
        ],
    }
    if use_room_schedule:
        service_data["use_room_schedule"] = True
    if override_room_schedule:
        service_data["override_room_schedule"] = True
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(service_data),
    )

    async def execute_sequence(*args, **kwargs):
        run_id = (
            "manual-with-schedule" if use_room_schedule else "manual-without-schedule"
        )
        run_manager = args[2]
        plan_id = args[1].data["plan_id"]
        run_rooms = args[5]
        await run_manager.ledger.async_begin_run(
            "serial",
            plan_id,
            run_id,
            len(run_rooms),
            trigger="user",
            service="clean_room_sequence",
        )
        await run_manager.ledger.async_mark_started(
            "serial", plan_id, run_rooms[0], run_id=run_id
        )
        cadence_by_room = kwargs["cadence_by_room"]
        await run_manager.recovery.async_set_recovery_checkpoint(
            "serial",
            run_id,
            {"cadence_by_room": cadence_by_room},
        )
        # This method is the managed executor's verified-completion boundary.
        await run_manager.ledger.async_mark_completed(
            "serial", plan_id, run_rooms[0], run_id=run_id
        )

    execute = AsyncMock(side_effect=execute_sequence)
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {room.id: room.name}),
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute,
        ),
    ):
        await _registered_handler(services, "clean_room_sequence")(call)

    effective_mode = (
        "vacuum_and_mop"
        if use_room_schedule and not override_room_schedule
        else requested_mode
    )
    assert execute.await_args.args[5] == [
        CleaningRoom(
            room.id,
            room.name,
            effective_mode,
            "quick" if use_room_schedule and not override_room_schedule else "standard",
        )
    ]
    snapshot = execute.await_args.kwargs["cadence_by_room"][room.id]
    assert execute.await_args.args[1].data["plan_id"] == (
        f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_1"
    )
    assert snapshot["scope"] == ("shared" if use_room_schedule else "plan")
    assert snapshot["schedule_active"] is use_room_schedule
    assert snapshot["mop_due"] is use_room_schedule
    assert snapshot["coverage_due"] is use_room_schedule
    expected_progress = (
        {"mop": 0, "coverage": 1}
        if use_room_schedule and effective_mode == "vacuum_and_mop"
        else {"mop": 1, "coverage": 1}
    )
    assert (
        manager.repository.robot("serial")["shared_room_cadence"][room.id]["progress"]
        == expected_progress
    )
    assert (
        manager.repository.robot("serial")["plans"]["quick_clean"]["name"]
        == "Quick Clean"
    )
    assert (
        manager.repository.robot("serial")["plans"][MANUAL_ROOM_SEQUENCE_PLAN_ID][
            "name"
        ]
        == "Legacy saved plan"
    )
    assert (
        manager.repository.robot("serial")["plan_room_cadence"]["quick_clean"][room.id][
            "progress"
        ]
        == private_progress_before
    )


async def test_manual_room_run_identity_preserves_legacy_saved_plan_ids(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.catalog.release_manual_room_sequence_plan_id("serial", "unreserved")
    # A saved plan that predates the private namespace remains editable.
    manager.repository.robot("serial")["plans"][MANUAL_ROOM_SEQUENCE_PLAN_ID] = {
        "name": "Existing plan",
        "rooms": [],
    }
    await manager.catalog.async_save_plan(
        "serial",
        MANUAL_ROOM_SEQUENCE_PLAN_ID,
        {"name": "Edited plan", "rooms": []},
    )
    assert manager.catalog.plan("serial", MANUAL_ROOM_SEQUENCE_PLAN_ID)["name"] == (
        "Edited plan"
    )

    first = manager.catalog.reserve_manual_room_sequence_plan_id("serial")
    assert first == f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_1"
    with pytest.raises(ValueError, match="reserved for manual Map Studio room runs"):
        await manager.catalog.async_save_plan("serial", first, {"name": "Collision"})
    manager.catalog.release_manual_room_sequence_plan_id("serial", first)
    with pytest.raises(ValueError, match="reserved for manual Map Studio room runs"):
        await manager.catalog.async_save_plan(
            "serial", first, {"name": "Spoofed plan", "rooms": []}
        )

    # A legacy plan already using this ID may still be edited after release.
    manager.repository.robot("serial")["plans"][first] = {
        "name": "Legacy manual plan",
        "rooms": [],
    }
    await manager.catalog.async_save_plan(
        "serial", first, {"name": "Edited plan", "rooms": []}
    )
    assert manager.catalog.plan("serial", first)["name"] == "Edited plan"

    second = manager.catalog.reserve_manual_room_sequence_plan_id("serial")
    assert second == f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_2"
    manager.catalog.release_manual_room_sequence_plan_id("serial", second)
    manager.repository.robot("serial")["last_run"] = {
        "run_id": "running-manual",
        "plan_id": second,
        "outcome": "running",
    }
    with pytest.raises(ValueError, match="reserved for manual Map Studio room runs"):
        await manager.catalog.async_save_plan(
            "serial", second, {"name": "Still active"}
        )
    manager.repository.robot("serial")["last_run"] = None
    manager.catalog.release_manual_room_sequence_plan_id("serial", second)
    with pytest.raises(ValueError, match="reserved for manual Map Studio room runs"):
        await manager.catalog.async_save_plan("serial", second, {"name": "Released ID"})


async def test_manual_room_reservation_skips_persisted_run_owners(hass) -> None:
    manager = CleaningPlanManager(hass)
    robot = manager.repository.robot("serial")
    robot["last_run"] = {
        "run_id": "running-manual",
        "plan_id": MANUAL_ROOM_SEQUENCE_PLAN_ID,
        "outcome": "running",
    }
    robot["active_plan"] = {
        "plan_id": f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_1",
        "room_id": "room-office",
    }
    robot["pending_native_reconciliation"] = {
        "plan_id": f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_2",
        "room_id": "room-office",
        "room": "Office",
        "dispatched_at": "2026-09-28T12:00:00+00:00",
        "expires_at": "2099-09-28T12:00:00+00:00",
    }

    reserved = manager.catalog.reserve_manual_room_sequence_plan_id("serial")

    assert reserved == f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_3"
    manager.catalog.release_manual_room_sequence_plan_id("serial", reserved)


async def test_reset_room_cadence_service_targets_one_room_and_reports_blockers(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                },
                {
                    "room_id": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
    )
    manager.repository.robot("serial")["plan_room_cadence"]["home"]["room-office"] = {
        "identity": None,
        "progress": {"mop": 2, "coverage": 4},
    }
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {})
    reset = ServiceCall(
        hass,
        DOMAIN,
        "reset_room_cadence",
        {
            "entity_id": ["vacuum.test"],
            "plan": "Home",
            "room_id": "room-office",
            "modes": ["mop"],
        },
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        result = await _registered_handler(services, "reset_room_cadence")(reset)
    assert result == {
        "plan_id": "home",
        "reset_room_ids": ["room-office"],
        "reset_modes": ["mop"],
    }
    assert manager.cadence.cadence_progress("serial", "home", "room-office")["mop"] == 0
    assert (
        manager.cadence.cadence_progress("serial", "home", "room-office")["coverage"]
        == 4
    )

    all_rooms = ServiceCall(
        hass,
        DOMAIN,
        "reset_room_cadence",
        {
            "entity_id": ["vacuum.test"],
            "plan": "Home",
            "modes": ["coverage", "mop", "mop"],
        },
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        all_result = await _registered_handler(services, "reset_room_cadence")(
            all_rooms
        )
    assert all_result == {
        "plan_id": "home",
        "reset_room_ids": ["room-office", "room-study"],
        "reset_modes": ["mop", "coverage"],
    }

    other_room = ServiceCall(
        hass,
        DOMAIN,
        "reset_room_cadence",
        {"entity_id": ["vacuum.test"], "plan": "Home", "room_id": "room-attic"},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as outside,
    ):
        await _registered_handler(services, "reset_room_cadence")(other_room)
    assert outside.value.translation_key == "room_not_in_plan"
    assert outside.value.translation_placeholders == {
        "room": "room-attic",
        "plan": "Home",
    }

    manager.repository.robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": "room-office",
    }
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as blocked,
    ):
        await _registered_handler(services, "reset_room_cadence")(reset)
    assert blocked.value.translation_key == "cadence_reset_blocked"


async def test_reset_room_cadence_service_returns_no_receipt_on_save_failure(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager.repository.store = SimpleNamespace(async_save=save)
    room = {
        "room_id": "room-office",
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }
    await manager.catalog.async_save_plan(
        "serial", "home", {"name": "Home", "rooms": [room]}
    )
    manager.repository.robot("serial")["plan_room_cadence"]["home"] = {
        "room-office": {"progress": {"mop": 1, "coverage": 0}}
    }
    save.side_effect = OSError("disk unavailable")
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "reset_room_cadence",
        {"entity_id": ["vacuum.test"], "plan": "Home"},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", SimpleNamespace(), "serial", {}),
        ),
        pytest.raises(OSError, match="disk unavailable"),
    ):
        await _registered_handler(services, "reset_room_cadence")(call)


async def test_cadence_room_edit_rolls_back_when_persistence_fails(hass) -> None:
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager.repository.store = SimpleNamespace(async_save=save)
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(
                floor_plan=floor_plan,
                refresh=AsyncMock(),
                confirm_room_completed=MagicMock(),
            ),
            client=robot_client(
                async_get_active_cleaning_session_state=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(
                    return_value=b"native-task"
                ),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    identity = _plan_cadence_bindings(entry)[1][room.id]
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    schedule = manager.repository.robot("serial")["shared_room_cadence"][room.id]
    schedule["progress"] = {"mop": 2, "coverage": 0}
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {room.id: room.name})
    update = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Home",
                "rooms": [
                    {
                        "room": room.id,
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "cadence": {"scope": "shared", "mop_every_n": 5},
                    }
                ],
            }
        ),
    )
    save.side_effect = OSError("disk unavailable")
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(OSError, match="disk unavailable"),
    ):
        await _registered_handler(services, "save_plan")(update)

    assert (
        manager.catalog.plan("serial", "home")["rooms"][0]["cadence"]["mop_every_n"]
        == 3
    )
    assert schedule["progress"] == {"mop": 2, "coverage": 0}


async def test_plan_cadence_bindings_uses_verified_current_map() -> None:
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    floor_token, identities = _plan_cadence_bindings(entry)
    assert floor_token == plan_floor_token(floor_plan)
    assert set(identities) == {room.id for room in floor_plan.rooms}


async def test_late_native_completion_uses_current_room_cadence_identity(hass) -> None:
    robot = FakeRobot()
    room = CleaningRoom("room-office", "Office", "vacuum", "quick")
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    now = dt_util.utcnow()
    reconciliation = _NativeReconciliation(
        "home", room.room_id, room.name, now - timedelta(seconds=10)
    )
    record = CleaningSessionRecord(
        b"late-native-session",
        CleaningSession(
            (now - timedelta(seconds=12)).isoformat(),
            now.isoformat(),
            12,
            (room.name,),
            ((room.name, 12),),
            True,
            completed_rooms=(room.name,),
        ),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.ledger.async_mark_native_completed = AsyncMock(return_value=True)
    robot.show("docked")
    with (
        patch(
            "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_POLL_SECONDS",
            0,
        ),
        patch(
            "custom_components.matic_robot.managed_reconciliation.current_room_cadence_identity",
            return_value=_plan_cadence_bindings(entry)[1][room.room_id],
        ),
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            robot.port(session_history=AsyncMock(return_value=(record,))),
            None,
        )
    assert (
        manager.ledger.async_mark_native_completed.await_args.kwargs["room_identity"]
        == _plan_cadence_bindings(entry)[1][room.room_id]
    )


async def test_tracked_run_checkpoints_its_cadence_snapshot_before_dispatch(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    cancel = asyncio.Event()
    cancel.set()
    manager.control.prepare_run = MagicMock(return_value=cancel)
    checkpoint_write = AsyncMock(wraps=manager.recovery.async_set_recovery_checkpoint)
    manager.recovery.async_set_recovery_checkpoint = checkpoint_write
    room = CleaningRoom("room-office", "Office", "vacuum", "quick")
    cadence_snapshot = {
        room.room_id: {
            "scope": "shared",
            "mop_due": True,
            "coverage_due": False,
            "identity": "synthetic-room-identity",
        }
    }
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {
            "plan_id": "quick_clean",
            "return_to_base": False,
            "start_timeout": 120,
            "completion_timeout": 21600,
        },
    )
    with patch(
        "custom_components.matic_robot.managed_dispatch._ensure_stop_settled",
        new=AsyncMock(),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.test",
            "serial",
            [room],
            robot=robot_port(),
            cadence_by_room=cadence_snapshot,
            floor_token="synthetic-floor-token",
        )

    checkpoint_write.assert_awaited()
    checkpoint = checkpoint_write.await_args.args[2]
    assert checkpoint["cadence_by_room"] == cadence_snapshot
    assert checkpoint["rooms"] == [
        {
            "room_id": room.room_id,
            "name": room.name,
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
        }
    ]


@pytest.mark.parametrize("service", ["run_selected_plan", "clean_room_sequence"])
async def test_cleaning_service_rejects_invalid_cadence_resolution(
    hass, service: str
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager.cadence.resolve_cadence = MagicMock(
        side_effect=ValueError("invalid cadence")
    )
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        entry,
        "serial",
        {"room-office": "Office"},
    )
    if service == "run_selected_plan":
        call = ServiceCall(
            hass,
            DOMAIN,
            service,
            {"entity_id": ["vacuum.test"], "plan": "Home"},
        )
    else:
        call = ServiceCall(
            hass,
            DOMAIN,
            service,
            CLEAN_ROOM_SEQUENCE_SCHEMA(
                {
                    "entity_id": ["vacuum.test"],
                    "rooms": [
                        {
                            "room": "Office",
                            "cleaning_mode": "vacuum",
                            "coverage_setting": "quick",
                        }
                    ],
                }
            ),
        )

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, service)(call)

    assert raised.value.translation_key == "invalid_plan"


@pytest.mark.parametrize(
    "rooms, message",
    [([], "plan has no rooms"), (["malformed"], "plan contains an invalid room")],
)
async def test_run_selected_plan_rejects_malformed_authoritative_preview(
    hass, rooms, message: str
) -> None:
    """Never dispatch data that failed authoritative preview materialization."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager.planning.preview = MagicMock(
        return_value={"plan_id": "home", "rooms": rooms}
    )
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {"room-office": "Office"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {"entity_id": ["vacuum.test"], "plan": "Home"},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(),
        ) as execute,
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(call)
    assert str(raised.value.__cause__) == message

    assert raised.value.translation_key == "invalid_plan"
    execute.assert_not_awaited()


async def test_all_daily_limited_rooms_block_saved_and_manual_dispatch(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    identity = room_cadence_identity(floor_plan, room.id)
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
        },
    )
    await manager.cadence.async_set_daily_limit(
        "serial",
        room.id,
        room_identity=identity,
        limit=1,
        require_current=lambda: True,
    )
    now = dt_util.utcnow()
    daily_room_limit.record_completion(
        manager.repository.robot("serial"),
        room.id,
        identity,
        now.isoformat(),
        now=now,
    )
    services = await _registered_services(hass, manager)
    session = _session(floor_plan=floor_plan, refresh=AsyncMock())
    client = robot_client(
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
        async_get_cleaning_session_records=AsyncMock(return_value=()),
        async_get_cleaning_session_identity=AsyncMock(return_value=b"native"),
    )
    entry = SimpleNamespace(
        entry_id="entry-daily-limit",
        runtime_data=SimpleNamespace(
            session=session,
            client=client,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    context = ("vacuum.test", entry, "serial", {room.id: room.name})
    saved = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Home"}),
    )
    manual = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "rooms": [
                    {
                        "room": room.id,
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    }
                ],
            }
        ),
    )
    execute = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute,
        ),
    ):
        preview = await _registered_handler(services, "preview_plan")(
            ServiceCall(hass, DOMAIN, "preview_plan", {"plan": "Home"})
        )
        assert preview["blocker"] == "daily_limit_reached"
        assert preview["daily_limit_held_rooms"][0]["room_id"] == room.id
        for service, call in (
            ("run_selected_plan", saved),
            ("clean_room_sequence", manual),
        ):
            with pytest.raises(ServiceValidationError) as raised:
                await _registered_handler(services, service)(call)
            assert raised.value.translation_key == "daily_room_limit_reached"

    execute.assert_not_awaited()


async def test_legacy_oversized_plan_cannot_be_previewed_or_dispatched(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_rooms = tuple(
        Room(
            f"room-{index}",
            f"Room {index}",
            f"protocol-{index}",
            f"wire-{index}".encode(),
            (),
        )
        for index in range(1, MAX_ROOM_SEQUENCE_SIZE + 2)
    )
    floor_plan = FloorPlan(
        42, "synthetic-partition", b"synthetic-partition", floor_rooms
    )
    room_map = {room.id: room.name for room in floor_rooms}
    manager.repository.robot("serial")["plans"]["legacy"] = {
        "name": "Legacy",
        "enabled": True,
        "run_behavior": "ordered",
        "rooms": [
            {
                "room_id": room.id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
            for room in floor_rooms
        ],
        "room_order": [room.id for room in floor_rooms],
    }
    with pytest.raises(RoomSequenceLimitError, match="at most 100 rooms"):
        manager.planning.preview("serial", room_map, "legacy")

    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {"entity_id": ["vacuum.test"], "plan": "Legacy"},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", room_map),
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(),
        ) as execute,
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(call)

    assert raised.value.translation_key == "room_sequence_limit"
    execute.assert_not_awaited()


async def test_tokenized_saved_run_localizes_preview_failure_after_preflight(
    hass,
) -> None:
    """A preview failure after executor settlement remains recoverable."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            session=_session(
                floor_plan=floor_plan,
                refresh=AsyncMock(),
                confirm_room_completed=MagicMock(),
            ),
            client=robot_client(
                async_get_active_cleaning_session_state=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(
                    return_value=b"native-task"
                ),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {"room-office": "Office"})
    preview_call = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Home"}),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        preview = await _registered_handler(services, "preview_plan")(preview_call)

    original_preview = manager.planning.preview
    preview_calls = 0

    def fail_after_initial_preview(*args, **kwargs):
        nonlocal preview_calls
        preview_calls += 1
        if preview_calls > 1:
            raise ValueError("authoritative preview unavailable")
        return original_preview(*args, **kwargs)

    manager.planning.preview = MagicMock(side_effect=fail_after_initial_preview)
    token_call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        RUN_SELECTED_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Home",
                "preview_token": preview["preview_token"],
            }
        ),
    )

    async def invoke_validation(*_args, **kwargs) -> None:
        kwargs["validate_prepared_run"]()

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(side_effect=invoke_validation),
        ) as execute,
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)

    assert raised.value.translation_key == "invalid_plan"
    execute.assert_awaited_once()


@pytest.mark.parametrize("run_behavior", ["intelligent", "ordered"])
@pytest.mark.parametrize("changed_input", ["plan", "map", "cadence"])
async def test_run_without_preview_revalidates_after_stop_settlement(
    hass, run_behavior: str, changed_input: str
) -> None:
    """A run started without a preview rejects changed authority before dispatch."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 2},
                }
            ],
        },
    )
    cadence = manager.repository.robot("serial")["plan_room_cadence"][
        "home"
    ].setdefault(
        "room-office",
        {"identity": None, "progress": {"mop": 0, "coverage": 0}},
    )
    session = _session(
        floor_plan=floor_plan, refresh=AsyncMock(), confirm_room_completed=MagicMock()
    )
    client = robot_client(
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
        async_get_cleaning_session_records=AsyncMock(return_value=()),
        async_get_cleaning_session_identity=AsyncMock(return_value=b"native-task"),
        async_send_user_command=AsyncMock(),
    )
    entry = SimpleNamespace(
        entry_id="entry-legacy-revalidation",
        runtime_data=SimpleNamespace(
            session=session,
            client=client,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    context = ("vacuum.test", entry, "serial", {"room-office": "Office"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        RUN_SELECTED_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Home",
                "run_behavior": run_behavior,
            }
        ),
    )
    services = await _registered_services(hass, manager)
    settlement_started = asyncio.Event()
    finish_settlement = asyncio.Event()
    room_start = AsyncMock()

    def mutate_authority() -> None:
        if changed_input == "plan":
            manager.repository.robot("serial")["plans"]["home"]["return_to_base"] = (
                False
            )
        elif changed_input == "map":
            session.floor.value = _area_floor_plan(mission_id=43)
        else:
            cadence["progress"]["mop"] = 1

    async def settle_then_dispatch(*_args, **kwargs) -> None:
        settlement_started.set()
        await finish_settlement.wait()
        kwargs["validate_prepared_run"]()
        await room_start()

    execute = AsyncMock(side_effect=settle_then_dispatch)
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            execute,
        ),
    ):
        pending = asyncio.create_task(
            _registered_handler(services, "run_selected_plan")(call)
        )
        await settlement_started.wait()
        mutate_authority()
        finish_settlement.set()
        with pytest.raises(ServiceValidationError) as raised:
            await pending

    assert raised.value.translation_key == "plan_preview_changed"
    execute.assert_awaited_once()
    room_start.assert_not_awaited()
    client.async_send_user_command.assert_not_awaited()


async def test_intelligent_exact_preview_stop_and_reset_actions(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    study = CleaningRoom("room-study", "Study", "vacuum", "quick")
    office = CleaningRoom("room-office", "Office", "mop", "heavy_duty")
    await manager.catalog.async_save_plan(
        "serial",
        "upstairs",
        {
            "name": "Upstairs",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                }
                for room in (study, office)
            ],
            "return_to_base": True,
        },
    )
    await manager.ledger.async_mark_started("serial", "upstairs", study)
    await manager.ledger.async_mark_completed("serial", "upstairs", study)
    services = await _registered_services(hass, manager)
    floor_plan = _area_floor_plan()
    floor_plan = replace(
        floor_plan,
        rooms=(
            Room(
                "room-study",
                "Study",
                "protocol-study",
                b"study",
                floor_plan.rooms[0].boundary,
            ),
            Room(
                "room-office",
                "Office",
                "protocol-office",
                b"office",
                floor_plan.rooms[0].boundary,
            ),
        ),
    )
    session = _session(
        floor_plan=floor_plan,
        refresh=AsyncMock(),
        discard_current_room=MagicMock(),
        confirm_room_completed=MagicMock(),
    )
    client = robot_client(
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
        async_get_cleaning_session_records=AsyncMock(return_value=()),
        async_get_cleaning_session_identity=AsyncMock(return_value=b"native-task"),
        async_send_user_command=AsyncMock(),
    )
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            session=session,
            client=client,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    context = (
        "vacuum.test",
        entry,
        "serial",
        {"room-study": "Study", "room-office": "Office"},
    )

    plan = {"entity_id": ["vacuum.test"], "plan": "Upstairs"}

    def run_call(**options: str) -> ServiceCall:
        return ServiceCall(
            hass,
            DOMAIN,
            "run_selected_plan",
            RUN_SELECTED_PLAN_SCHEMA({**plan, **options}),
        )

    async def exercise_managed_command(*_args, **kwargs) -> None:
        token = manager.control.begin_managed_motion("serial")
        try:
            await kwargs["managed_user_command"](token, UserCommand.STOP)
        finally:
            manager.control.end_managed_motion("serial", token)

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(side_effect=exercise_managed_command),
        ) as execute,
    ):
        for options in (
            {"run_behavior": "intelligent"},
            {"run_behavior": "ordered"},
            {},
        ):
            await _registered_handler(services, "run_selected_plan")(
                run_call(**options)
            )
        preview = await _registered_handler(services, "preview_plan")(
            ServiceCall(hass, DOMAIN, "preview_plan", SAVED_PLAN_SERVICE_SCHEMA(plan))
        )

    assert execute.await_count == 3
    dispatched_orders = [
        [
            (room.room_id, room.cleaning_mode, room.coverage_setting)
            for room in args.args[5]
        ]
        for args in execute.await_args_list
    ]
    assert dispatched_orders == [
        [
            ("room-office", "mop", "heavy_duty"),
            ("room-study", "vacuum", "quick"),
        ],
        [
            ("room-study", "vacuum", "quick"),
            ("room-office", "mop", "heavy_duty"),
        ],
        [
            ("room-study", "vacuum", "quick"),
            ("room-office", "mop", "heavy_duty"),
        ],
    ]
    with pytest.raises(probatio.Invalid):
        run_call(run_behavior="fastest")
    assert "intelligent" not in execute.await_args_list[0].kwargs
    assert execute.await_args_list[0].kwargs["robot"].refresh is (
        session.heartbeat.async_request_refresh
    )
    assert "intelligent" not in execute.await_args_list[1].kwargs
    assert "intelligent" not in execute.await_args_list[2].kwargs
    floor_guard = execute.await_args_list[0].kwargs["floor_is_current"]
    assert execute.await_args_list[0].kwargs["floor_token"] == plan_floor_token(
        floor_plan
    )
    assert floor_guard() is True
    session.floor.value = replace(
        floor_plan,
        rooms=tuple(replace(room, name="The Study") for room in floor_plan.rooms),
    )
    assert floor_guard() is False
    session.floor.value = replace(
        floor_plan,
        rooms=tuple(
            replace(room, name="Office" if room.name == "Study" else "Study")
            for room in floor_plan.rooms
        ),
    )
    assert floor_guard() is False
    session.floor.value = replace(
        floor_plan,
        rooms=tuple(
            replace(room, boundary=tuple((x + 0.025, y) for x, y in room.boundary))
            for room in floor_plan.rooms
        ),
    )
    assert floor_guard() is True
    session.floor.value = _area_floor_plan(mission_id=43)
    assert floor_guard() is False
    session.floor.value = floor_plan
    assert client.async_send_user_command.await_count == 3
    assert "stop_fence_expires_at" in manager.repository.robot("serial")
    assert preview["plan_name"] == "Upstairs"
    assert preview["run_behavior"] == "ordered"
    assert preview["rooms"][0]["room_id"] == "room-study"
    assert preview["rooms"][1]["room_id"] == "room-office"
    assert len(preview["preview_token"]) == 64

    token_call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        RUN_SELECTED_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Upstairs",
                "preview_token": preview["preview_token"],
            }
        ),
    )

    async def validate_tokenized_run(*_args, **kwargs) -> None:
        assert "intelligent" not in kwargs
        kwargs["validate_prepared_run"]()

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(side_effect=validate_tokenized_run),
        ) as token_execute,
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)
    token_execute.assert_awaited_once()

    # A preview covers the saved order only, so another order needs a new one.
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(),
        ) as other_order_execute,
        pytest.raises(ServiceValidationError, match="preview is stale"),
    ):
        await _registered_handler(services, "run_selected_plan")(
            run_call(preview_token=preview["preview_token"], run_behavior="intelligent")
        )
    other_order_execute.assert_not_awaited()

    async def mutate_saved_plan_before_dispatch(*_args, **kwargs) -> None:
        manager.repository.robot("serial")["plans"]["upstairs"]["return_to_base"] = (
            False
        )
        kwargs["validate_prepared_run"]()

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(side_effect=mutate_saved_plan_before_dispatch),
        ) as changed_execute,
        pytest.raises(ServiceValidationError, match="resolution changed") as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)
    changed_execute.assert_awaited_once()
    assert raised.value.translation_key == "plan_preview_changed"

    manager.repository.robot("serial")["plans"]["upstairs"]["return_to_base"] = True
    manager.repository.robot("serial")["plans"]["upstairs"]["return_to_base"] = False
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_execution._async_execute_rooms",
            AsyncMock(),
        ) as stale_execute,
        pytest.raises(ServiceValidationError, match="preview is stale") as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)
    stale_execute.assert_not_awaited()
    assert raised.value.translation_key == "plan_preview_changed"
    manager.repository.robot("serial")["plans"]["upstairs"]["return_to_base"] = True

    lock = manager.control.lock("serial")
    await lock.acquire()
    manager.control.prepare_run("serial")
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    assert manager.control.cancellation_event("serial").is_set()
    session.heartbeat.async_discard_current_room.assert_called_once_with()
    lock.release()
    services.async_call.assert_awaited_with(
        "vacuum",
        "return_to_base",
        {"entity_id": "vacuum.test"},
        blocking=True,
        context=stop.context,
    )

    plan = manager.catalog.plan("serial", "upstairs")
    plan_id = plan.pop("id")
    plan["finish_current_room"] = True
    plan["finish_current_room_threshold"] = 50
    await manager.catalog.async_save_plan("serial", plan_id, plan, select=False)
    services.async_call.reset_mock()
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": ["vacuum.test"], "include_unmanaged": True},
    )
    await lock.acquire()
    manager.control.prepare_run("serial")
    await manager.ledger.async_mark_started(
        "serial",
        "upstairs",
        CleaningRoom("room-study", "Study", "vacuum", "quick"),
    )
    try:
        with patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ):
            await _registered_handler(services, "stop_intelligent_cleaning")(stop)
        services.async_call.assert_not_awaited()
        assert manager.control.finish_room_event("serial").is_set()
    finally:
        lock.release()

    reset = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        {"entity_id": ["vacuum.test"], "plan": "Upstairs", "all_plans": False},
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "reset_plan_history")(reset)


async def test_stop_now_only_overrides_the_matching_pending_smart_stop(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"]["upstairs"] = {
        "name": "Upstairs",
        "finish_current_room": True,
        "finish_current_room_threshold": 50,
        "rooms": [
            {
                "room_id": "room-study",
                "name": "Study",
                "cleaning_mode": "vacuum",
                "coverage_setting": "quick",
            }
        ],
    }
    services = await _registered_services(hass, manager)
    session = _session(discard_current_room=MagicMock())
    entry = SimpleNamespace(runtime_data=SimpleNamespace(session=session))
    context = ("vacuum.test", entry, "serial", {"room-study": "Study"})
    run_id = "smart-stop-run"
    await manager.ledger.async_begin_run(
        "serial",
        "upstairs",
        run_id,
        1,
        trigger="test",
        service="test",
        finish_current_room=True,
    )
    await manager.recovery.async_set_recovery_checkpoint(
        "serial",
        run_id,
        {"rooms": [], "leg_index": 0, "phase": "ready"},
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    await manager.ledger.async_mark_started("serial", "upstairs", room, run_id=run_id)
    active = manager.repository.robot("serial")["active_plan"]
    active["active_elapsed_seconds"] = 60
    active["active_segment_started"] = None
    manager.control.finish_room_event("serial").set()
    await manager.recovery.async_checkpoint_stop_intent(
        "serial", "after_room", run_id=run_id
    )
    lock = manager.control.lock("serial")
    await lock.acquire()
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {
            "entity_id": ["vacuum.test"],
            "stop_now": True,
            "expected_run_id": run_id,
        },
    )
    try:
        await manager.ledger.async_mark_verifying(
            "serial", "upstairs", room, checkpoint=verifying_write(dt_util.utcnow())
        )
        verifying = manager.history.snapshot("serial")["active_plan"]
        assert verifying["smart_stop_phase"] == "verifying_completion"
        with patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ):
            with pytest.raises(ServiceValidationError) as raised:
                await _registered_handler(services, "stop_intelligent_cleaning")(stop)
            assert raised.value.translation_key == "smart_stop_not_pending"
            assert manager.control.finish_room_event("serial").is_set()
            assert not manager.control.cancellation_event("serial").is_set()
            services.async_call.assert_not_awaited()
            manager.repository.robot("serial")["active_plan"]["status"] = "running"
            await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    finally:
        lock.release()
    assert (
        manager.history.snapshot("serial")["active_plan"]["smart_stop_pending"] is False
    )
    assert manager.control.finish_room_event("serial").is_set() is False
    session.heartbeat.async_discard_current_room.assert_called_once_with()
    services.async_call.assert_awaited_once_with(
        "vacuum",
        "return_to_base",
        {"entity_id": "vacuum.test"},
        blocking=True,
        context=stop.context,
    )
    repeated = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {
            "entity_id": ["vacuum.test"],
            "stop_now": True,
            "expected_run_id": run_id,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "stop_intelligent_cleaning")(repeated)
    assert raised.value.translation_key == "smart_stop_not_pending"
    services.async_call.assert_awaited_once()


async def test_managed_actions_ignore_inactive_stop(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "disabled",
        {"name": "Disabled", "enabled": False, "rooms": []},
    )
    services = await _registered_services(hass, manager)
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"one": "Kitchen"})
    missing = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    reset_missing = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        {"entity_id": ["vacuum.test"], "plan": "Missing", "all_plans": False},
    )
    disabled = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Disabled"}),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "preview_plan")(missing)
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "run_selected_plan")(missing)
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "reset_plan_history")(reset_missing)
        with pytest.raises(ServiceValidationError, match="turned off"):
            await _registered_handler(services, "preview_plan")(disabled)
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    services.async_call.assert_not_awaited()


@pytest.mark.parametrize("include_unmanaged", [False, True])
async def test_stop_resolves_unmanaged_cleaning_without_a_room_map(
    hass, include_unmanaged
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    session = _session(discard_current_room=MagicMock())
    entry = SimpleNamespace(runtime_data=SimpleNamespace(session=session))
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": ["vacuum.test"], "include_unmanaged": include_unmanaged},
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {}),
    ) as resolve:
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    resolve.assert_called_once_with(hass, ["vacuum.test"], require_rooms=False)
    if include_unmanaged:
        session.heartbeat.async_discard_current_room.assert_called_once_with()
        services.async_call.assert_awaited_once_with(
            "vacuum",
            "return_to_base",
            {"entity_id": "vacuum.test"},
            blocking=True,
            context=stop.context,
        )
    else:
        session.heartbeat.async_discard_current_room.assert_not_called()
        services.async_call.assert_not_awaited()


@pytest.mark.parametrize("field", ["mop_every_n", "coverage_every_n"])
@pytest.mark.parametrize("value", [True, False, 2.9, "3", 0, 101])
def test_service_cadence_schema_rejects_non_integer_or_out_of_range_intervals(
    field: str, value: object
) -> None:
    payload = {"scope": "shared", field: value}
    original = deepcopy(payload)

    with pytest.raises(probatio.Invalid):
        ROOM_CADENCE_SCHEMA(payload)

    assert payload == original


@pytest.mark.parametrize("field", ["mop_every_n", "coverage_every_n"])
@pytest.mark.parametrize("value", [1, 100])
def test_service_cadence_schema_preserves_valid_integer_intervals(
    field: str, value: int
) -> None:
    payload = {"scope": "shared", field: value}

    normalized = ROOM_CADENCE_SCHEMA(payload)

    assert normalized[field] == value


@pytest.mark.parametrize("flag", ["do_mop_next", "do_coverage_next"])
async def test_save_plan_service_rejects_one_shot_without_interval(
    hass, flag: str
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Broken one-shot",
                "rooms": [
                    {
                        "room": room.id,
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence": {flag: True},
                    }
                ],
            }
        ),
    )
    context = ("vacuum.test", SimpleNamespace(), "serial", {room.id: room.name})

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_editing._plan_cadence_bindings",
            return_value=(None, {}),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "save_plan")(call)

    assert raised.value.translation_key == "invalid_plan"
    assert manager.catalog.plans("serial") == {}
    manager.repository.store.async_save.assert_not_awaited()


async def test_delete_room_schedule_service_uses_current_binding_and_exact_token(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    floor_token, room_identities = _plan_cadence_bindings(entry)
    await manager.catalog.async_save_plan(
        "serial",
        "cadence-test",
        {
            "name": "Cadence test",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=floor_token,
        room_identities=room_identities,
    )
    services = await _registered_services(hass, manager)
    token = manager.cadence.shared_cadence_delete_token("serial", room.id)
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_room_schedule",
        DELETE_ROOM_SCHEDULE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "room_id": room.id,
                "expected_token": token,
            }
        ),
    )
    context = ("vacuum.test", entry, "serial", {room.id: room.name})
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        result = await _registered_handler(services, "delete_room_schedule")(call)

    assert result == {"room_id": room.id, "affected_plan_ids": ["cadence-test"]}
    assert room.id not in manager.repository.robot("serial")["shared_room_cadence"]
    assert "cadence" not in manager.catalog.plan("serial", "cadence-test")["rooms"][0]


@pytest.mark.parametrize(
    ("error", "translation_key"),
    [
        (
            plan_model_module.SharedRoomScheduleLockedError("locked"),
            "cadence_delete_blocked",
        ),
        (
            plan_model_module.SharedRoomScheduleMapChangedError("map changed"),
            "cadence_delete_map_changed",
        ),
        (
            plan_model_module.SharedRoomScheduleStaleError("stale"),
            "cadence_delete_stale",
        ),
        (ValueError("invalid map binding"), "cadence_delete_map_changed"),
    ],
)
async def test_delete_room_schedule_service_translates_manager_errors(
    hass, error, translation_key
) -> None:
    manager = CleaningPlanManager(hass)
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_room_schedule",
        DELETE_ROOM_SCHEDULE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "room_id": room.id,
                "expected_token": "0" * 64,
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {room.id: room.name}),
        ),
        patch.object(
            manager.cadence,
            "async_delete_room_schedule",
            new_callable=AsyncMock,
            side_effect=error,
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "delete_room_schedule")(call)

    assert raised.value.translation_key == translation_key


async def test_delete_room_schedule_service_rejects_room_missing_from_current_map(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_room_schedule",
        DELETE_ROOM_SCHEDULE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "room_id": room.id,
                "expected_token": "0" * 64,
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {}),
        ),
        patch.object(
            manager.cadence, "async_delete_room_schedule", new_callable=AsyncMock
        ) as delete,
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "delete_room_schedule")(call)

    assert raised.value.translation_key == "cadence_delete_map_changed"
    delete.assert_not_awaited()


async def test_save_plan_returns_manager_normalized_shared_cadence(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    floor_token, room_identities = _plan_cadence_bindings(entry)
    await manager.catalog.async_save_plan(
        "serial",
        "source",
        {
            "name": "Source",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=floor_token,
        room_identities=room_identities,
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {room.id: room.name})

    save = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Joined",
                "rooms": [
                    {
                        "room": room.id,
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "cadence": {"scope": "shared", "mop_every_n": 7},
                    }
                ],
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        saved = await _registered_handler(services, "save_plan")(save)

    assert saved["plan"] == manager.catalog.plan("serial", "joined")
    assert saved["plan"]["rooms"][0]["cadence"]["mop_every_n"] == 3


async def test_plan_crud_is_complete(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen", "room-study": "Study"},
    )
    save = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Away cleaning",
                "rooms": [
                    {
                        "room": "room-study",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                    },
                    {
                        "room": "Kitchen",
                        "cleaning_mode": "vacuum_and_mop",
                        "coverage_setting": "standard",
                    },
                ],
            }
        ),
    )
    listing = ServiceCall(hass, DOMAIN, "list_plans", {"entity_id": ["vacuum.test"]})
    delete = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Away cleaning"}),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        saved = await _registered_handler(services, "save_plan")(save)
        plans = await _registered_handler(services, "list_plans")(listing)
        deleted = await _registered_handler(services, "delete_plan")(delete)
    assert saved["plan"]["id"] == "away_cleaning"
    assert [room["room_id"] for room in plans["plans"][0]["rooms"]] == [
        "room-study",
        "room-kitchen",
    ]
    assert plans["selected_plan"] == "away_cleaning"
    assert deleted["deleted_plan_id"] == "away_cleaning"
    assert manager.catalog.plans("serial") == {}


async def test_save_plan_allows_only_strict_legacy_room_reductions(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        {
            "room_id": f"room-{index}",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }
        for index in range(1, 103)
    ]
    manager.repository.robot("serial")["plans"]["legacy"] = {
        "name": "Legacy",
        "enabled": True,
        "run_behavior": "ordered",
        "rooms": rooms,
        "room_order": [room["room_id"] for room in rooms],
    }
    room_map = {f"room-{index}": f"Room {index}" for index in range(1, 103)}
    services = await _registered_services(hass, manager)

    def save_call(plan_id: str, selected_rooms: list[dict[str, str]]) -> ServiceCall:
        return ServiceCall(
            hass,
            DOMAIN,
            "save_plan",
            SAVE_PLAN_SCHEMA(
                {
                    "entity_id": ["vacuum.test"],
                    "plan_id": plan_id,
                    "name": "Legacy" if plan_id == "legacy" else "New plan",
                    "rooms": [
                        {
                            "room": room_map[room["room_id"]],
                            "cleaning_mode": room["cleaning_mode"],
                            "coverage_setting": room["coverage_setting"],
                        }
                        for room in selected_rooms
                    ],
                }
            ),
        )

    context = ("vacuum.test", SimpleNamespace(), "serial", room_map)
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_editing._plan_cadence_bindings",
            return_value=(None, {}),
        ),
    ):
        # An equal-size replacement cannot masquerade as legacy recovery.
        equal_size_with_new_room = [*rooms[:-1], {**rooms[-1], "room_id": "room-1"}]
        with pytest.raises(ServiceValidationError) as equal_size_error:
            await _registered_handler(services, "save_plan")(
                save_call("legacy", equal_size_with_new_room)
            )
        assert equal_size_error.value.translation_key == "room_sequence_limit"
        assert manager.repository.store.async_save.await_count == 0

        duplicate_room = [*rooms[1:100], rooms[0], rooms[0]]
        with pytest.raises(ServiceValidationError) as duplicate_error:
            await _registered_handler(services, "save_plan")(
                save_call("legacy", duplicate_room)
            )
        assert duplicate_error.value.translation_key == "room_sequence_limit"
        assert manager.repository.store.async_save.await_count == 0

        for selected_rooms in (rooms[1:], rooms[2:]):
            await _registered_handler(services, "save_plan")(
                save_call("legacy", selected_rooms)
            )

        assert len(manager.catalog.plan("serial", "legacy")["rooms"]) == 100
        assert manager.repository.store.async_save.await_count == 2

        with pytest.raises(ServiceValidationError) as new_plan_error:
            await _registered_handler(services, "save_plan")(
                save_call("new", rooms[1:])
            )
        assert new_plan_error.value.translation_key == "room_sequence_limit"
        assert "new" not in manager.catalog.plans("serial")
        assert manager.repository.store.async_save.await_count == 2


@pytest.mark.parametrize("legacy_rooms", [None, 17])
async def test_save_plan_recovers_malformed_persisted_room_container(
    hass, legacy_rooms
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"]["damaged"] = {
        "name": "Damaged legacy plan",
        "rooms": legacy_rooms,
    }
    room_map = {"room-kitchen": "Kitchen"}
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan_id": "damaged",
                "name": "Recovered plan",
                "rooms": [{"room": "Kitchen"}],
            }
        ),
    )

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", SimpleNamespace(), "serial", room_map),
        ),
        patch(
            "custom_components.matic_robot.service_editing._plan_cadence_bindings",
            return_value=(None, {}),
        ),
    ):
        await _registered_handler(services, "save_plan")(call)

    assert manager.catalog.plan("serial", "damaged")["rooms"] == [
        {
            "room_id": "room-kitchen",
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "standard",
        }
    ]
    manager.repository.store.async_save.assert_awaited_once()


async def test_save_plan_reports_the_per_robot_plan_limit(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"].update(
        {
            f"plan-{index}": {"name": f"Plan {index}", "rooms": []}
            for index in range(MAX_SAVED_PLANS_PER_ROBOT)
        }
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "One too many",
                "rooms": [{"room": "Kitchen"}],
            }
        ),
    )
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen"},
    )

    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "save_plan")(call)
    assert raised.value.translation_key == "plan_limit_reached"

    assert isinstance(raised.value.__cause__, SavedPlanLimitError)
    manager.repository.store.async_save.assert_not_awaited()


async def test_save_plan_translates_cadence_edit_blocked_during_run(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager.repository.robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": room.id,
    }
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan_id": "home",
                "name": "Home",
                "rooms": [
                    {
                        "room": room.id,
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "cadence": {"scope": "plan", "mop_every_n": 3},
                    }
                ],
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {room.id: room.name}),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "save_plan")(call)

    assert raised.value.translation_key == "invalid_plan"
    assert isinstance(raised.value.__cause__, ValueError)


async def test_delete_plan_translates_running_plan_lock(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial", "home", {"name": "Home", "rooms": []}
    )
    manager.repository.robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": "room-office",
    }
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Home"}),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", SimpleNamespace(), "serial", {}),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "delete_plan")(call)

    assert raised.value.translation_key == "plan_locked"
    assert isinstance(raised.value.__cause__, ValueError)
    assert manager.catalog.plan("serial", "home")["name"] == "Home"


async def test_plan_edits_reject_unknown_rooms_and_plans(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    bad_room = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Test",
                "rooms": [{"room": "Missing"}],
            }
        ),
    )
    unknown = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="Unknown Matic room"):
            await _registered_handler(services, "save_plan")(bad_room)
        with pytest.raises(ServiceValidationError, match="Unknown Matic cleaning"):
            await _registered_handler(services, "delete_plan")(unknown)
    assert manager.catalog.plans("serial") == {}


def test_saved_plan_context_requires_one_robot_and_live_rooms() -> None:
    """The room map must come from the session, not published attributes.

    0.2.0 removed the vacuum's ``rooms`` state attribute, so this seam
    deliberately builds the context from the real session floor plan.
    """
    hass = SimpleNamespace(states=SimpleNamespace(get=MagicMock(return_value=None)))
    robot = ["vacuum.test"]
    floor_plan = SimpleNamespace(
        rooms=(
            SimpleNamespace(id="one", name="Kitchen"),
            SimpleNamespace(id="two", name="Study"),
        )
    )
    session = _session(
        info=SimpleNamespace(serial_number="synthetic-serial"),
        floor_plan=floor_plan,
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=session,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    with patch(
        "custom_components.matic_robot.service_context._entry_for_entity",
        return_value=entry,
    ):
        assert _saved_plan_context(hass, robot)[2:] == (
            "synthetic-serial",
            {"one": "Kitchen", "two": "Study"},
        )
        assert _saved_plan_context(hass, robot, require_current_floor=True)[3] == {
            "one": "Kitchen",
            "two": "Study",
        }
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
        with pytest.raises(ServiceValidationError, match="room map"):
            _saved_plan_context(hass, robot, require_current_floor=True)
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
        session.floor.value = None
        with pytest.raises(ServiceValidationError, match="room map"):
            _saved_plan_context(hass, robot)
        assert _saved_plan_context(hass, robot, require_rooms=False)[3] == {}
    with pytest.raises(ServiceValidationError, match="exactly one"):
        _saved_plan_context(hass, ["vacuum.one", "vacuum.two"])


async def test_saved_plan_context_reads_rooms_the_vacuum_actually_exposes() -> None:
    """Guard the producer/consumer seam with the real vacuum entity.

    The context and the vacuum entity must agree on the same session
    floor plan so a state-attribute change can never break plan services.
    """
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    entry = entity_entry()
    entity = vacuum_platform.MaticVacuum(entry)
    hass = SimpleNamespace(states=SimpleNamespace(get=MagicMock(return_value=None)))

    with patch(
        "custom_components.matic_robot.service_context._entry_for_entity",
        return_value=entry,
    ):
        room_map = _saved_plan_context(hass, ["vacuum.test"])[3]

    assert room_map == entity.extra_state_attributes["rooms"]
    assert room_map == {"room-1": "Kitchen", "room-2": "Study"}


def _resolution_hass(*, loaded: bool = True, available: bool = True):
    entity = SimpleNamespace(platform=DOMAIN, config_entry_id="entry")
    registry = SimpleNamespace(async_get=MagicMock(return_value=entity))
    entry = SimpleNamespace(
        state=ConfigEntryState.LOADED if loaded else ConfigEntryState.SETUP_RETRY
    )
    state = SimpleNamespace(state="docked" if available else "unavailable")
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry)),
        states=SimpleNamespace(get=MagicMock(return_value=state)),
    )
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    referenced = SimpleNamespace(
        referenced={"vacuum.test"}, indirectly_referenced=set()
    )
    return hass, call, registry, referenced


def test_action_target_resolution_accepts_loaded_matic_vacuum() -> None:
    hass, call, registry, referenced = _resolution_hass()
    with (
        patch(
            "custom_components.matic_robot.service_context.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.service_context.er.async_get",
            return_value=registry,
        ),
    ):
        assert _resolve_loaded_matic_vacuums(hass, call.data) == ["vacuum.test"]


async def test_firmware_metadata_services_accept_offline_loaded_robot() -> None:
    hass = SimpleNamespace(
        data={},
        auth=SimpleNamespace(
            async_get_user=AsyncMock(return_value=SimpleNamespace(is_admin=True))
        ),
    )
    services = await _registered_services(hass)
    entity = SimpleNamespace(platform=DOMAIN, config_entry_id="entry")
    registry = SimpleNamespace(async_get=MagicMock(return_value=entity))
    entry = SimpleNamespace(state=ConfigEntryState.LOADED, entry_id="entry")
    hass.config_entries = SimpleNamespace(async_get_entry=MagicMock(return_value=entry))
    hass.states = SimpleNamespace(
        get=MagicMock(return_value=SimpleNamespace(state="unavailable"))
    )
    referenced = SimpleNamespace(
        referenced={"vacuum.test"}, indirectly_referenced=set()
    )
    investigator = ServiceCall(
        hass,
        DOMAIN,
        "firmware_investigator",
        {"entity_id": ["vacuum.test"], "provider": "researcher"},
        context=Context(user_id="admin"),
    )
    notification = ServiceCall(
        hass,
        DOMAIN,
        "firmware_notification",
        {
            "entity_id": ["vacuum.test"],
            "report_id": "a" * 24,
            "revision": 2,
            "action": "acknowledge",
        },
        context=Context(user_id="admin"),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.service_context.er.async_get",
            return_value=registry,
        ),
    ):
        await _registered_handler(services, "firmware_investigator")(investigator)
        await _registered_handler(services, "firmware_notification")(notification)

    tracker = hass.data[DOMAIN]["firmware_tracker"]
    tracker.async_configure_investigator.assert_awaited_once_with("entry", "researcher")
    tracker.async_notification_action.assert_awaited_once_with(
        "entry", "a" * 24, 2, "acknowledge"
    )


async def test_physical_domain_service_still_rejects_offline_loaded_robot() -> None:
    hass = SimpleNamespace(
        data={},
        services=SimpleNamespace(async_call=AsyncMock()),
    )
    services = await _registered_services(hass)
    entity = SimpleNamespace(platform=DOMAIN, config_entry_id="entry")
    registry = SimpleNamespace(async_get=MagicMock(return_value=entity))
    entry = SimpleNamespace(state=ConfigEntryState.LOADED, entry_id="entry")
    hass.config_entries = SimpleNamespace(async_get_entry=MagicMock(return_value=entry))
    hass.states = SimpleNamespace(
        get=MagicMock(return_value=SimpleNamespace(state="unavailable"))
    )
    referenced = SimpleNamespace(
        referenced={"vacuum.test"}, indirectly_referenced=set()
    )
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    with (
        patch(
            "custom_components.matic_robot.service_context.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.service_context.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        _registration(services, "clean")[3](dict(call.data))
    hass.services.async_call.assert_not_awaited()


async def test_domain_service_rejects_unauthorized_direct_and_indirect_targets() -> (
    None
):
    user = SimpleNamespace(
        is_admin=False,
        permissions=SimpleNamespace(
            check_entity=MagicMock(
                side_effect=lambda entity_id, _policy: entity_id.endswith("allowed")
            )
        ),
    )
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=AsyncMock(return_value=user))
    )
    handler = AsyncMock()
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        {"device_id": ["robot-device"]},
        context=Context(user_id="restricted-user"),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.allowed", "vacuum.denied"],
        ),
        pytest.raises(Unauthorized) as raised,
    ):
        await _require_matic_control(hass, handler)(call)

    assert raised.value.entity_id == "vacuum.denied"
    handler.assert_not_awaited()


async def test_domain_service_allows_control_admin_and_system_contexts() -> None:
    handler = AsyncMock(return_value={"ok": True})
    allowed_user = SimpleNamespace(
        is_admin=False,
        permissions=SimpleNamespace(check_entity=MagicMock(return_value=True)),
    )
    admin = SimpleNamespace(
        is_admin=True,
        permissions=SimpleNamespace(check_entity=MagicMock(return_value=False)),
    )
    hass = SimpleNamespace(
        auth=SimpleNamespace(
            async_get_user=AsyncMock(side_effect=(allowed_user, admin, None))
        )
    )
    guarded = _require_matic_control(hass, handler)
    with patch(
        "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
        return_value=["vacuum.test"],
    ):
        assert await guarded(
            ServiceCall(
                hass,
                DOMAIN,
                "clean",
                {"entity_id": ["vacuum.test"]},
                context=Context(user_id="allowed-user"),
            )
        ) == {"ok": True}
        assert await guarded(
            ServiceCall(
                hass,
                DOMAIN,
                "clean",
                {"entity_id": ["vacuum.test"]},
                context=Context(user_id="admin-user"),
            )
        ) == {"ok": True}
        assert await guarded(
            ServiceCall(hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"]})
        ) == {"ok": True}
        with pytest.raises(UnknownUser):
            await guarded(
                ServiceCall(
                    hass,
                    DOMAIN,
                    "clean",
                    {"entity_id": ["vacuum.test"]},
                    context=Context(user_id="missing-user"),
                )
            )

    admin.permissions.check_entity.assert_not_called()
    assert handler.await_count == 3


@pytest.mark.parametrize(("loaded", "available"), [(False, True), (True, False)])
def test_action_target_resolution_rejects_unavailable_robot(loaded, available) -> None:
    hass, call, registry, referenced = _resolution_hass(
        loaded=loaded, available=available
    )
    with (
        patch(
            "custom_components.matic_robot.service_context.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.service_context.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        _resolve_loaded_matic_vacuums(hass, call.data)


def test_action_target_resolution_rejects_non_matic_target() -> None:
    hass, call, registry, referenced = _resolution_hass()
    registry.async_get.return_value = SimpleNamespace(
        platform="other", config_entry_id="entry"
    )
    with (
        patch(
            "custom_components.matic_robot.service_context.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.service_context.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="Select at least one"),
    ):
        _resolve_loaded_matic_vacuums(hass, call.data)


async def test_inspect_hermes_endpoint_returns_bounded_safe_snapshot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_inspect_endpoint=AsyncMock(
            return_value=(HermesCollectionEntry(b"key", b"payload"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.test"],
            "endpoint": "wifi_status",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
    ):
        response = await _registered_handler(services, "inspect_hermes_endpoint")(call)
    assert response["kind"] == "property"
    assert response["entries"][0]["key_size"] == 3
    assert response["entries"][0]["value_size"] == 7
    assert "key" not in response["entries"][0]
    client.async_inspect_endpoint.assert_awaited_once_with("wifi_status", limit=1)


async def test_inspect_hermes_endpoint_requires_exactly_one_robot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.one", "vacuum.two"],
            "endpoint": "wifi_status",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "inspect_hermes_endpoint")(call)


async def test_inspect_hermes_endpoint_fingerprints_payloads() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_inspect_endpoint=AsyncMock(
            return_value=(HermesCollectionEntry(b"key", b"payload"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.test"],
            "endpoint": "wifi_status",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
    ):
        response = await _registered_handler(services, "inspect_hermes_endpoint")(call)
    assert response["entries"][0]["key_sha256"] == (
        "2c70e12b7a0646f92279f427c7b38e7334d8e5389cff167a1dc30e73f826b683"
    )
    assert response["entries"][0]["value_sha256"] == (
        "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5"
    )


async def test_inspect_pose_endpoint_returns_only_safe_vector_paths() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_inspect_endpoint=AsyncMock(
            return_value=(HermesCollectionEntry(b"", b"synthetic"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.test"],
            "endpoint": "latest_pose",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
        patch(
            "custom_components.matic_robot.service_firmware.pose_vector_paths",
            return_value=((2, 1, 1),),
        ),
    ):
        response = await _registered_handler(services, "inspect_hermes_endpoint")(call)

    assert response["pose_vector_paths"] == [[2, 1, 1]]


async def test_firmware_snapshot_persists_safe_full_endpoint_sweep() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)

    async def inspect(name: str, *, limit: int):
        assert limit == 1
        if name == "zones":
            return ()
        if name == "map_integrated":
            raise CannotConnectError("synthetic failure with private context")
        return (HermesCollectionEntry(b"key", b"value"),)

    client = SimpleNamespace(async_inspect_endpoint=AsyncMock(side_effect=inspect))
    session = SimpleNamespace(
        client=client,
        telemetry=Store(
            SimpleNamespace(software_version="v168.11", protocol_version=25)
        ),
        state=Store(
            LiveState(
                SimpleNamespace(
                    software_version="fallback",
                    activity=SimpleNamespace(value="cleaning"),
                ),
                None,
            )
        ),
    )
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(client=client, session=session),
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_snapshot",
        {"entity_id": ["vacuum.test"]},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
        patch(
            "custom_components.matic_robot.firmware.snapshot_timestamp",
            return_value="timestamp",
        ),
    ):
        response = await _registered_handler(services, "firmware_snapshot")(call)

    assert response["endpoint_count"] == len(HERMES_ENDPOINTS)
    assert response["analysis_version"] == ANALYSIS_VERSION
    assert response["observation_context"] == "cleaning"
    assert response["populated_endpoints"] == len(HERMES_ENDPOINTS) - 2
    assert response["empty_endpoints"] == 1
    assert response["failed_endpoints"] == 1
    assert response["structural_endpoints"] == 0
    assert response["wire_shape_count"] == 0
    failed = next(item for item in response["endpoints"] if item["status"] == "error")
    assert failed["error_type"] == "CannotConnectError"
    assert "synthetic failure" not in repr(response)
    tracker = hass.data[DOMAIN]["firmware_tracker"]
    tracker.async_record_snapshot.assert_awaited_once()
    tracker.occurrence_generation.assert_called_once_with("entry")
    assert tracker.async_record_snapshot.await_args.kwargs == {
        "occurrence_generation": 0
    }


async def test_firmware_admin_services_resolve_one_robot_and_wrap_tracker_errors() -> (
    None
):
    hass = SimpleNamespace(data={}, auth=SimpleNamespace(async_get_user=AsyncMock()))
    services = await _registered_services(hass)
    first_entry = SimpleNamespace(entry_id="entry-one")
    second_entry = SimpleNamespace(entry_id="entry-two")
    tracker = hass.data[DOMAIN]["firmware_tracker"]
    investigator_call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_investigator",
        {"entity_id": ["vacuum.one"], "provider": "researcher"},
        context=Context(user_id="admin"),
    )
    notification_call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_notification",
        {
            "entity_id": ["vacuum.two"],
            "report_id": "a" * 24,
            "revision": 7,
            "action": "acknowledge",
        },
        context=Context(user_id="admin"),
    )
    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=True)
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            side_effect=[["vacuum.one"], ["vacuum.two"]],
        ) as resolve,
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            side_effect=[first_entry, second_entry],
        ) as entry_for_entity,
    ):
        await _registered_handler(services, "firmware_investigator")(investigator_call)
        await _registered_handler(services, "firmware_notification")(notification_call)

    assert resolve.call_count == 2
    assert entry_for_entity.call_args_list[-2].args == (hass, "vacuum.one")
    assert entry_for_entity.call_args_list[-1].args == (hass, "vacuum.two")
    tracker.async_configure_investigator.assert_awaited_once_with(
        "entry-one", "researcher"
    )
    tracker.async_notification_action.assert_awaited_once_with(
        "entry-two", "a" * 24, 7, "acknowledge"
    )


async def test_firmware_services_require_admin_and_one_robot() -> None:
    hass = SimpleNamespace(data={}, auth=SimpleNamespace(async_get_user=AsyncMock()))
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_investigator",
        {"entity_id": ["vacuum.one"], "provider": "researcher"},
        context=Context(user_id="non-admin"),
    )
    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=False)
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one"],
        ),
        pytest.raises(Unauthorized),
    ):
        await _registered_handler(services, "firmware_investigator")(call)
    tracker = hass.data[DOMAIN]["firmware_tracker"]
    tracker.async_configure_investigator.assert_not_awaited()

    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=True)
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "firmware_investigator")(call)
    notification = ServiceCall(
        hass,
        DOMAIN,
        "firmware_notification",
        {
            "entity_id": ["vacuum.one", "vacuum.two"],
            "report_id": "a" * 24,
            "revision": 1,
            "action": "delivered",
        },
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "firmware_notification")(notification)


@pytest.mark.parametrize(
    ("service", "method", "call_data"),
    [
        (
            "firmware_investigator",
            "async_configure_investigator",
            {"entity_id": ["vacuum.one"], "provider": "researcher"},
        ),
        (
            "firmware_notification",
            "async_notification_action",
            {
                "entity_id": ["vacuum.one"],
                "report_id": "a" * 24,
                "revision": 3,
                "action": "recheck",
            },
        ),
    ],
)
async def test_firmware_services_translate_tracker_value_errors(
    service, method, call_data
) -> None:
    hass = SimpleNamespace(data={}, auth=SimpleNamespace(async_get_user=AsyncMock()))
    services = await _registered_services(hass)
    tracker = hass.data[DOMAIN]["firmware_tracker"]
    getattr(tracker, method).side_effect = ValueError("stale firmware request")
    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=True)
    call = ServiceCall(
        hass, DOMAIN, service, call_data, context=Context(user_id="admin")
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=SimpleNamespace(entry_id="entry-one"),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, service)(call)
    assert (
        raised.value.translation_key
        == {
            "firmware_investigator": "firmware_evidence_unavailable",
            "firmware_notification": "firmware_notification_stale",
        }[service]
    )


async def test_firmware_investigator_rejects_unusable_names() -> None:
    hass = SimpleNamespace(data={}, auth=SimpleNamespace(async_get_user=AsyncMock()))
    services = await _registered_services(hass)
    tracker = hass.data[DOMAIN]["firmware_tracker"]
    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=True)
    call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_investigator",
        {"entity_id": ["vacuum.one"], "provider": "Open Claw"},
        context=Context(user_id="admin"),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=SimpleNamespace(entry_id="entry-one"),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "firmware_investigator")(call)
    assert raised.value.translation_key == "invalid_investigator"
    tracker.async_configure_investigator.assert_not_called()


@pytest.mark.parametrize(
    ("error", "key", "placeholders"),
    [
        (
            RoomSequenceLimitError("internal limit detail"),
            "room_sequence_limit",
            {"limit": "100"},
        ),
        (PlanDisabledError("internal disabled detail"), "plan_disabled", None),
        (EmptyPlanError("internal empty detail"), "plan_empty", None),
        (DuplicateRoomError("internal duplicate detail"), "duplicate_room", None),
        (
            CadenceBindingError("internal binding detail"),
            "room_schedule_map_unconfirmed",
            None,
        ),
        (ValueError("internal detail"), "invalid_plan", None),
    ],
)
def test_plan_request_errors_never_expose_internal_text(
    error: ValueError, key: str, placeholders: dict[str, str] | None
) -> None:
    translated = _plan_request_error(error)
    assert translated.translation_key == key
    assert translated.translation_placeholders == placeholders
    assert str(error) not in str(translated)


async def test_firmware_snapshot_requires_exactly_one_robot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_snapshot",
        {"entity_id": ["vacuum.one", "vacuum.two"]},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "firmware_snapshot")(call)


async def test_plan_runs_reject_disabled_plans_and_unknown_selection(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial", "disabled", {"name": "Disabled", "enabled": False, "rooms": []}
    )
    services = await _registered_services(hass, manager)
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            session=_session(floor_plan=floor_plan),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"one": "Kitchen"})
    disabled = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Disabled"}),
    )
    missing = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="turned off"):
            await _registered_handler(services, "run_selected_plan")(disabled)
        with pytest.raises(ServiceValidationError, match="Unknown Matic cleaning"):
            await _registered_handler(services, "run_selected_plan")(missing)


async def test_save_plan_rejects_names_that_produce_no_plan_id(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "???",
                "rooms": [{"room": "Kitchen"}],
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as excinfo,
    ):
        await _registered_handler(services, "save_plan")(call)
    assert excinfo.value.translation_key == "plan_name_unusable"
    assert excinfo.value.translation_placeholders is None
    assert manager.catalog.plans("serial") == {}


@pytest.mark.parametrize("run_id", [None, "synthetic-run"])
async def test_oem_stop_reconciliation_credits_late_native_session(
    hass, run_id
) -> None:
    """The ten-minute OEM stop can finish a room after the runner saw an error."""
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    events = []
    hass.bus.async_listen("matic_robot_room_reconciled", events.append)
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
            "run_id": run_id,
        },
    )
    assert (
        manager.ledger.pending_native_reconciliation("serial").get("run_id") == run_id
    )
    session = CleaningSession(
        (now - timedelta(seconds=10)).isoformat(),
        (now - timedelta(seconds=1)).isoformat(),
        9,
        (room.name,),
        ((room.name, 9),),
        True,
        (room.name,),
    )
    reads = AsyncMock(side_effect=[(), (CleaningSessionRecord(b"new", session),)])
    robot.show("docked")
    confirmed = MagicMock()
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, now - timedelta(seconds=5), run_id=run_id
    )
    with patch(
        "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_POLL_SECONDS",
        0,
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            robot.port(session_history=reads, confirm_room_completed=confirmed),
            None,
        )

    record = manager.history.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert record["last_result"] == "completed"
    assert record["last_duration_seconds"] == 9
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False
    confirmed.assert_called_once_with(room.name)
    await hass.async_block_till_done()
    assert events[0].data.get("run_id") == run_id


async def test_reconciliation_abandons_a_room_seen_ending_in_place(hass) -> None:
    """Watching the robot stop disproves the completion its record claims."""
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    dispatched_at = dt_util.utcnow() - timedelta(seconds=30)
    manager.repository.robot("serial")["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (dt_util.utcnow() + timedelta(minutes=12)).isoformat(),
    }
    ended = dt_util.utcnow()
    record = CleaningSessionRecord(
        b"late",
        CleaningSession(
            (ended - timedelta(seconds=20)).isoformat(),
            ended.isoformat(),
            20,
            ("Study",),
            (("Study", 20),),
            True,
            completed_rooms=("Study",),
        ),
    )
    robot.show("idle", current_area="Study")
    confirmed: list[str] = []

    with (
        patch(
            "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_SECONDS",
            0.05,
        ),
        patch(
            "custom_components.matic_robot.managed_reconciliation."
            "OEM_STOP_RECONCILIATION_POLL_SECONDS",
            0,
        ),
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.matic",
            room,
            _NativeReconciliation("away", room.room_id, room.name, dispatched_at),
            frozenset(),
            robot.port(
                session_history=AsyncMock(return_value=(record,)),
                confirm_room_completed=confirmed.append,
            ),
            None,
        )

    assert confirmed == []
    snapshot = manager.history.snapshot("serial")
    assert snapshot["last_completed_by_room"].get(room.room_id) is None


async def test_native_stop_reconciliation_handles_transport_and_timeout(hass) -> None:
    robot = FakeRobot()
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager.repository.store = SimpleNamespace(async_save=save)
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        },
    )
    save.reset_mock()
    robot.show("cleaning")
    history = AsyncMock(side_effect=MaticError("synthetic offline"))
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, now - timedelta(seconds=5)
    )
    with (
        patch(
            "custom_components.matic_robot.managed_reconciliation.monotonic",
            side_effect=[0, 0, 1],
        ),
        patch(
            "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_SECONDS",
            1,
        ),
        patch(
            "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_POLL_SECONDS",
            0,
        ),
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            robot.port(session_history=history),
            None,
        )
    history.assert_awaited_once()
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False
    save.assert_awaited_once()


async def test_native_stop_reconciliation_expires_without_history_baseline(
    hass,
) -> None:
    """Missing pre-dispatch history disables credit, not durable cleanup."""
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager.repository.store = SimpleNamespace(async_save=save)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
        },
    )
    save.reset_mock()
    history = AsyncMock()
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, dispatched_at
    )

    with (
        patch(
            "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_SECONDS",
            1,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
        ) as sleep,
    ):
        await _async_expire_native_reconciliation(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
        )

    sleep.assert_awaited_once_with(1)
    history.assert_not_awaited()
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False
    save.assert_awaited_once()


async def test_clear_native_reconciliation_requires_the_exact_marker(hass) -> None:
    """An old watcher cannot remove a newer durable reconciliation marker."""
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager.repository.store = SimpleNamespace(async_save=save)
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    dispatched_at = dt_util.utcnow() - timedelta(seconds=5)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
        },
    )
    save.reset_mock()

    assert (
        await manager.ledger.async_clear_native_reconciliation(
            "serial", "away", room.room_id, dispatched_at - timedelta(seconds=1)
        )
        is False
    )
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is True
    save.assert_not_awaited()

    save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        await manager.ledger.async_clear_native_reconciliation(
            "serial", "away", room.room_id, dispatched_at
        )
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is True
    save.side_effect = None

    assert (
        await manager.ledger.async_clear_native_reconciliation(
            "serial", "away", room.room_id, dispatched_at
        )
        is True
    )
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False
    assert save.await_count == 2  # failed clear plus successful retry


async def test_native_reconciliation_schedule_and_stop_fence_guards(hass) -> None:
    robot = FakeRobot()
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, now - timedelta(seconds=5)
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    created: list[str] = []

    def create_background_task(coro, name: str) -> asyncio.Task:
        created.append(name)
        return hass.async_create_task(asyncio.sleep(0, coro.close()))

    _schedule_native_reconciliation(
        SimpleNamespace(async_create_background_task=create_background_task),
        manager,
        "serial",
        "vacuum.test",
        room,
        reconciliation,
        frozenset(),
        robot.port(session_history=AsyncMock()),
        None,
    )
    _schedule_native_reconciliation(
        SimpleNamespace(async_create_background_task=create_background_task),
        manager,
        "serial",
        "vacuum.test",
        room,
        reconciliation,
        None,
        robot.port(session_history=AsyncMock()),
        None,
    )
    assert len(created) == 2

    hass.states.async_set("vacuum.test", "cleaning")
    manager_with_fence = CleaningPlanManager(hass)
    manager_with_fence.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager_with_fence.control.mark_stop_pending("serial")
    native_active = AsyncMock(return_value=False)
    fresh_state = AsyncMock(
        return_value=SimpleNamespace(
            returning=False,
            cleaning=False,
            paused=False,
            charging=False,
            charging_idle=True,
            error_codes=(),
        )
    )
    with pytest.raises(ServiceValidationError) as blocked:
        await _ensure_stop_settled(
            hass,
            manager_with_fence,
            "serial",
            "vacuum.test",
            native_active,
            fresh_state,
        )
    assert blocked.value.translation_key == "robot_stop_pending"
    hass.states.async_set("vacuum.test", "docked")
    await _ensure_stop_settled(
        hass,
        manager_with_fence,
        "serial",
        "vacuum.test",
        native_active,
        fresh_state,
    )
    assert manager_with_fence.control.stop_pending("serial") is False

    manager_with_fence.control.mark_stop_pending("serial")
    await _ensure_stop_settled(
        hass,
        manager_with_fence,
        "serial",
        "vacuum.test",
        native_active,
        fresh_state,
    )
    assert manager_with_fence.control.stop_pending("serial") is False


async def test_native_reconciliation_schedule_registers_lifecycle_task() -> None:
    robot = FakeRobot()
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, dt_util.utcnow() - timedelta(seconds=5)
    )
    registered = MagicMock()
    manager = SimpleNamespace(
        ledger=SimpleNamespace(async_mark_native_completed=AsyncMock()),
        control=SimpleNamespace(register_reconciliation_task=registered),
    )

    def create_background_task(coro, name: str):
        return asyncio.create_task(coro, name=name)

    with patch(
        "custom_components.matic_robot.managed_reconciliation._async_reconcile_native_stop",
        AsyncMock(),
    ):
        _schedule_native_reconciliation(
            SimpleNamespace(async_create_background_task=create_background_task),
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            robot.port(session_history=AsyncMock()),
            None,
        )
        task = registered.call_args.args[1]
        await task

    registered.assert_called_once_with("serial", task)


def test_native_completion_match_rejects_old_or_invalid_records() -> None:
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    old = CleaningSessionRecord(
        b"old",
        CleaningSession(
            (now - timedelta(seconds=10)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            1,
            (room.name,),
            ((room.name, 1),),
            True,
            (room.name,),
        ),
    )
    missing_dates = CleaningSessionRecord(
        b"missing",
        CleaningSession(None, None, None, (room.name,), (), True, (room.name,)),
    )
    future = CleaningSessionRecord(
        b"future",
        CleaningSession(
            (now + timedelta(seconds=1)).isoformat(),
            (now + timedelta(seconds=2)).isoformat(),
            1,
            (room.name,),
            ((room.name, 1),),
            True,
            (room.name,),
        ),
    )
    assert (
        _native_completion_match((old,), frozenset({b"old"}), room, dispatched_at)
        is None
    )
    assert (
        _native_completion_match((missing_dates,), frozenset(), room, dispatched_at)
        is None
    )
    assert _native_completion_match((future,), frozenset(), room, dispatched_at) is None


async def test_wait_returns_immediately_when_state_is_already_desired(hass) -> None:
    robot = FakeRobot()
    robot.show("cleaning")
    state = await _async_wait_for_robot_activity(
        robot.port(), {RobotActivity.CLEANING}, 10
    )
    assert state is RobotActivity.CLEANING


async def test_wait_ignores_an_unreachable_robot_and_fails_on_error(hass) -> None:
    robot = FakeRobot()
    robot.show("idle")
    waiting = asyncio.create_task(
        _async_wait_for_robot_activity(robot.port(), {RobotActivity.CLEANING}, 10)
    )
    await asyncio.sleep(0)
    robot.show("unavailable")
    await asyncio.sleep(0)
    assert not waiting.done()
    robot.show("error")
    with pytest.raises(ServiceValidationError, match="reported an error") as excinfo:
        await waiting
    assert excinfo.value.translation_key == "robot_error"


async def test_wait_returns_reached_state_while_cancel_stays_pending(hass) -> None:
    robot = FakeRobot()
    robot.show("cleaning")
    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_robot_activity(robot.port(), {RobotActivity.DOCKED}, 10, cancel)
    )
    await asyncio.sleep(0)
    robot.show("docked")
    assert await waiting is RobotActivity.DOCKED
    assert not cancel.is_set()


@pytest.mark.parametrize("waiting_stage", ["preflight", "lock", "persist"])
async def test_stop_fences_a_pending_custom_area(hass, waiting_stage: str) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "test_area",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Test area",
            "circles": [{"x": 1.0, "y": 1.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "map_binding": legacy_bindings.v1(floor),
        },
    )
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=_session(floor_plan=floor, refresh=AsyncMock()),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    entered = asyncio.Event()
    release = asyncio.Event()
    first_check = True

    async def preflight(*_args) -> None:
        nonlocal first_check
        if first_check:
            first_check = False
            if waiting_stage != "persist":
                entered.set()
            if waiting_stage == "preflight":
                await release.wait()

    async def persist(*_args) -> None:
        if waiting_stage == "persist":
            entered.set()
            await release.wait()

    lock = manager.control.command_lock("serial")
    if waiting_stage == "lock":
        await lock.acquire()
    call = ServiceCall(hass, DOMAIN, "clean_area", {"area": "test_area"})
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"room-office": "Office"}),
        ),
        patch(
            "custom_components.matic_robot.service_controls._ensure_stop_settled",
            side_effect=preflight,
        ),
        patch.object(
            manager.control, "async_persist_reconciliation_removal", side_effect=persist
        ),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await entered.wait()
        manager.control.request_stop("serial")
        release.set()
        if waiting_stage == "lock":
            lock.release()
        with pytest.raises(ServiceValidationError, match="superseded"):
            await task
    client.async_start_custom_coverage.assert_not_awaited()


def test_entry_lookup_returns_loaded_entry_and_rejects_stale_references() -> None:
    registry = SimpleNamespace(
        async_get=MagicMock(return_value=SimpleNamespace(config_entry_id="entry"))
    )
    entry = SimpleNamespace()
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry))
    )
    with patch(
        "custom_components.matic_robot.service_context.er.async_get",
        return_value=registry,
    ):
        assert _entry_for_entity(hass, "vacuum.test") is entry
        hass.config_entries.async_get_entry.return_value = None
        with pytest.raises(ServiceValidationError, match="unavailable"):
            _entry_for_entity(hass, "vacuum.test")


async def test_plan_save_service_rejects_write_queued_when_unload_closes_admission(
    hass,
) -> None:
    """A waiting edit fails visibly instead of acknowledging stale plan data."""
    manager = CleaningPlanManager(hass)
    persisted: list[dict] = []

    async def save(data: dict) -> None:
        persisted.append(deepcopy(data))

    manager.repository.store = SimpleNamespace(async_save=save)
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Original",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
        },
    )
    original_persisted = deepcopy(persisted[-1])
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen"},
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan_id": "home",
                "name": "Replacement",
                "rooms": [
                    {
                        "room": "Kitchen",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    }
                ],
            }
        ),
    )
    plan_write_lock = manager.repository.plan_write_lock("serial")
    await plan_write_lock.acquire()
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_editing._plan_cadence_bindings",
            return_value=(None, {}),
        ),
    ):
        request = asyncio.create_task(_registered_handler(services, "save_plan")(call))
        try:
            for _ in range(20):
                if manager.repository.metadata_admissions.get("serial"):
                    break
                await asyncio.sleep(0)
            assert manager.repository.metadata_admissions.get("serial") == 1
            closing = asyncio.create_task(
                manager.repository.async_close_metadata_admission_and_wait("serial")
            )
            await asyncio.sleep(0)
            assert "serial" in manager.repository.metadata_admission_closed
            plan_write_lock.release()
            with pytest.raises(MetadataAdmissionClosedError):
                await request
            await closing
        finally:
            if plan_write_lock.locked():
                plan_write_lock.release()
            if not request.done():
                await asyncio.gather(request, return_exceptions=True)

    assert manager.catalog.plan("serial", "home")["name"] == "Original"
    assert persisted == [original_persisted]


async def test_delete_plan_reports_unavailable_metadata(hass) -> None:
    manager = CleaningPlanManager(hass)
    persisted: list[dict] = []

    async def save(data: dict) -> None:
        persisted.append(deepcopy(data))

    manager.repository.store = SimpleNamespace(async_save=save)
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Original",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
        },
    )
    original_persisted = deepcopy(persisted[-1])
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen"},
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "home"}),
    )
    await manager.repository.async_close_metadata_admission_and_wait("serial")
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(MetadataAdmissionClosedError),
    ):
        await _registered_handler(services, "delete_plan")(call)

    assert manager.catalog.plan("serial", "home")["name"] == "Original"
    assert persisted == [original_persisted]


async def test_firmware_reports_replay_after_home_assistant_started(hass):
    """Late-loaded integration immediately republishes persisted reports."""
    await _registered_services(hass, is_running=True)

    tracker = hass.data[DOMAIN][DATA_FIRMWARE_TRACKER]
    tracker.replay_reports.assert_called_once_with()
    hass.data[DOMAIN]["test_firmware_listen_once"].assert_not_called()


async def test_firmware_reports_replay_waits_for_home_assistant_started(hass):
    """Startup loads replay reports once the started event fires."""
    await _registered_services(hass)

    tracker = hass.data[DOMAIN][DATA_FIRMWARE_TRACKER]
    tracker.replay_reports.assert_not_called()
    listen_once = hass.data[DOMAIN]["test_firmware_listen_once"]
    listen_once.assert_called_once()
    event, callback = listen_once.call_args.args
    assert event == "homeassistant_started"
    from homeassistant.core import is_callback

    assert is_callback(callback)
    import threading

    callback_threads = []
    loop_thread = threading.get_ident()
    tracker.replay_reports.side_effect = lambda: callback_threads.append(
        threading.get_ident()
    )
    hass.bus.async_listen_once(event, callback)
    hass.bus.async_fire(event)
    await hass.async_block_till_done()
    tracker.replay_reports.assert_called_once_with()
    assert callback_threads == [loop_thread]


@pytest.mark.parametrize("route", ["service", "vacuum"])
@pytest.mark.parametrize("wait_stage", ["checkpoint", "replacement"])
async def test_stop_checkpoint_does_not_target_replacement_run(
    hass, route, wait_stage
) -> None:
    """Replacing the owner during persistence cannot inherit a pending Stop."""
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    serial = "synthetic-serial"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry = entity_entry()
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum_platform.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.test"
    await manager.ledger.async_begin_run(
        serial,
        "plan",
        "old-run",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=False,
    )
    await manager.recovery.async_set_recovery_checkpoint(
        serial, "old-run", {"phase": "accepted"}
    )
    await manager.ledger.async_mark_started(
        serial,
        "plan",
        CleaningRoom("room-2", "Study", "vacuum", "quick"),
        run_id="old-run",
    )
    lock = manager.control.lock(serial)
    await lock.acquire()
    manager.control.begin_managed_motion(serial)
    checkpoint = manager.recovery.async_checkpoint_stop_intent
    entered = asyncio.Event()
    release = asyncio.Event()

    async def delayed_checkpoint(*args, **kwargs):
        if wait_stage == "checkpoint":
            entered.set()
            await release.wait()
        await checkpoint(*args, **kwargs)

    persist_replacement = manager.control.async_persist_reconciliation_removal

    async def delayed_replacement(*args, **kwargs):
        if wait_stage == "replacement":
            entered.set()
            await release.wait()
        await persist_replacement(*args, **kwargs)

    manager.control.async_persist_reconciliation_removal = delayed_replacement

    services = await _registered_services(hass, manager)

    async def return_to_base(*_args, **_kwargs):
        await asyncio.create_task(entity.async_return_to_base())

    services.async_call.side_effect = return_to_base
    manager.recovery.async_checkpoint_stop_intent = delayed_checkpoint
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": ["vacuum.test"], "expected_run_id": "old-run"},
    )
    with (
        patch.object(RobotCommands, "schedule_dock_after_stop") as schedule_dock,
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, serial, {}),
        ),
    ):
        task = asyncio.create_task(
            _registered_handler(services, "stop_intelligent_cleaning")(stop)
            if route == "service"
            else entity.async_stop()
        )
        try:
            await asyncio.wait_for(entered.wait(), timeout=1)
            assert await manager.ledger.async_finish_run(
                serial,
                "old-run",
                "cancelled",
                "managed_stop",
                0,
            )
            lock.release()
            await lock.acquire()
            manager.control.prepare_run(serial)
            replacement_generation = manager.control.begin_managed_motion(serial)
            await manager.ledger.async_begin_run(
                serial,
                "plan",
                "new-run",
                1,
                trigger="user",
                service="run_selected_plan",
                finish_current_room=False,
            )
            await manager.recovery.async_set_recovery_checkpoint(
                serial, "new-run", {"phase": "accepted"}
            )
            await manager.ledger.async_mark_started(
                serial,
                "plan",
                CleaningRoom("room-2", "Study", "vacuum", "quick"),
                run_id="new-run",
            )
            release.set()
            if wait_stage == "replacement":
                with pytest.raises(ServiceValidationError, match="superseded"):
                    await task
            else:
                await task
        finally:
            release.set()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if lock.locked():
                lock.release()

    assert manager.ledger.active_run_id(serial) == "new-run"
    assert manager.control.managed_motion_is_current(serial, replacement_generation)
    assert not manager.control.cancellation_event(serial).is_set()
    assert (
        "stop_intent"
        not in manager.recovery.recovery_run(serial)["recovery_checkpoint"]
    )
    entry.runtime_data.session.client.async_send_user_command.assert_not_awaited()
    schedule_dock.assert_not_called()


@pytest.mark.parametrize("active_run", [None, "replacement-run", "motion-replaced"])
async def test_stop_expected_run_mismatch_has_no_effect(hass, active_run) -> None:
    """A stale observer cannot Stop a newer run or unmanaged cleaning."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    if active_run:
        await manager.ledger.async_begin_run(
            "serial",
            "plan",
            "old-run" if active_run == "motion-replaced" else active_run,
            1,
            trigger="user",
            service="run_selected_plan",
        )
    lock = None
    if active_run == "motion-replaced":
        lock = manager.control.lock("serial")
        await lock.acquire()
        manager.control.begin_managed_motion("serial")
        await manager.control.async_replace_managed_motion("serial")
        assert manager.ledger.active_run_id("serial") == "old-run"
        assert manager.control.cancellation_reason("serial") == "motion_replaced"
    services = await _registered_services(hass, manager)
    from tests.test_entities import _entry as entity_entry

    entry = entity_entry()
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {
            "entity_id": ["vacuum.test"],
            "expected_run_id": "old-run",
            "include_unmanaged": True,
        },
    )
    try:
        generation = manager.control.motion_generation("serial")
        with (
            patch(
                "custom_components.matic_robot.service_context._saved_plan_context",
                return_value=("vacuum.test", entry, "serial", {}),
            ),
            patch.object(
                manager.control, "request_stop", wraps=manager.control.request_stop
            ) as request_stop,
            patch.object(
                manager.recovery, "async_checkpoint_stop_intent", new_callable=AsyncMock
            ) as checkpoint,
            pytest.raises(ServiceValidationError, match="run has changed"),
        ):
            await _registered_handler(services, "stop_intelligent_cleaning")(stop)
        request_stop.assert_not_called()
        checkpoint.assert_not_awaited()
        services.async_call.assert_not_awaited()
        assert manager.control.motion_generation("serial") == generation
    finally:
        if lock is not None and lock.locked():
            lock.release()
