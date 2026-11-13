"""Integration setup and unload lifecycle tests."""

from __future__ import annotations

import asyncio
import math
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest
from homeassistant.components import frontend, panel_custom
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError

from custom_components.matic_robot import (
    async_remove_entry,
    async_setup,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.matic_robot.activity_events import ActivityEvents
from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    SCOPED_MAP_BINDING_VERSION,
    SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    AreaBindingStatus,
    area_binding_status,
    binding_for_area,
)
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    FloorPlan,
    RobotOperationalState,
    Room,
)
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
    DATA_FIRMWARE_TRACKER,
    DATA_LLM_API,
    DATA_PLAN_MANAGER,
    DOMAIN,
    PLATFORMS,
)
from custom_components.matic_robot.media_source import DATA_PHOTO_ATTACHMENT_SOURCE
from custom_components.matic_robot.photos import (
    RobotPhotoStore,
)
from custom_components.matic_robot.plan_model import AreaBindingUpgradeResult
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.slam_view_data import observe_trail
from custom_components.matic_robot.stores import CleaningHistory
from custom_components.matic_robot.workspace_socket import DATA_WORKSPACE_SOCKET
from tests.session_fakes import fake_session


@pytest.fixture(autouse=True)
def robot_session() -> Iterator[SimpleNamespace]:
    """Put a fake session over the fake client and return it.

    Its ``async_start`` is a mock, and stopping it shuts the client down.
    """
    session = fake_session(
        operational=RobotOperationalState(
            50, (), (), False, False, False, False, False, False
        )
    )
    session.async_start = AsyncMock()

    def build(_hass, _entry, client) -> SimpleNamespace:
        session.client = client
        session.async_stop = client.async_shutdown
        return session

    with patch("custom_components.matic_robot.RobotSession", build):
        yield session


def _wifi_survey() -> SimpleNamespace:
    return SimpleNamespace(
        async_load=AsyncMock(),
        async_collect=MagicMock(return_value=MagicMock()),
        async_shutdown=AsyncMock(),
        async_remove=AsyncMock(),
    )


def _entry() -> SimpleNamespace:
    def close_background_coroutine(hass, target, name):
        target.close()

    return SimpleNamespace(
        data={
            "host": "192.0.2.1",
            "port": 16320,
            CONF_HOSTNAME: "robot.invalid",
            CONF_SERIAL_NUMBER: "synthetic-serial",
            CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
            CONF_HERMES_CREDENTIAL: "test-credential",
        },
        options={},
        runtime_data=None,
        entry_id="entry",
        async_create_background_task=MagicMock(side_effect=close_background_coroutine),
        async_on_unload=MagicMock(),
        add_update_listener=MagicMock(),
    )


@pytest.mark.parametrize(
    "legacy_panel_api", [True, False], ids=["ha-2026.7-8", "ha-2026.9+"]
)
async def test_setup_registers_map_studio_when_frontend_is_loaded(
    legacy_panel_api: bool,
) -> None:
    async def register_legacy_panel(
        hass,
        frontend_url_path,
        webcomponent_name,
        sidebar_title=None,
        sidebar_icon=None,
        js_url=None,
        module_url=None,
        embed_iframe=False,
        trust_external=False,
        config=None,
        require_admin=False,
        config_panel_domain=None,
    ):
        """Match the strict panel API shared by Home Assistant 2026.7 and 2026.8."""

    register_panel = panel_custom.async_register_panel
    hass = SimpleNamespace(
        is_running=False,
        http=SimpleNamespace(
            register_view=MagicMock(), async_register_static_paths=AsyncMock()
        ),
        bus=SimpleNamespace(
            async_fire=MagicMock(),
            async_listen=MagicMock(return_value=MagicMock()),
            async_listen_once=MagicMock(return_value=MagicMock()),
        ),
        services=SimpleNamespace(async_register=MagicMock()),
        data={frontend.DATA_EXTRA_MODULE_URL: set()},
    )

    with (
        patch(
            "homeassistant.components.panel_custom.async_register_panel",
            autospec=register_legacy_panel if legacy_panel_api else register_panel,
            side_effect=register_panel,
        ) as panel_registration,
        patch("custom_components.matic_robot.services.CleaningPlanManager") as history,
        patch("custom_components.matic_robot.services.FirmwareTracker") as firmware,
        patch(
            "custom_components.matic_robot.async_register_matic_llm_api",
            return_value=SimpleNamespace(id="matic_robot_operations"),
        ),
        patch("custom_components.matic_robot.async_at_started"),
    ):
        history.return_value.async_load = AsyncMock()
        firmware.return_value.async_load = AsyncMock()
        assert await async_setup(hass, {}) is True

    hass.http.async_register_static_paths.assert_awaited_once()
    assert hass.http.register_view.call_count == 17
    from custom_components.matic_robot.frontend import (
        DATA_FLOOR_LAYERS_VIEW,
        DATA_RUN_THUMBNAIL_VIEW,
        DATA_SLAM_SCENE_VIEW,
        MATIC_ICONS_PATH,
        MATIC_MAP_PANEL_ELEMENT,
        MATIC_MAP_STUDIO_V4_PATH,
        MATIC_MAP_STUDIO_V4_ROOT_PATH,
    )

    assert hass.data[DATA_SLAM_SCENE_VIEW] in {
        call.args[0] for call in hass.http.register_view.call_args_list
    }
    assert hass.data[DATA_FLOOR_LAYERS_VIEW] in {
        call.args[0] for call in hass.http.register_view.call_args_list
    }
    assert hass.data[DATA_RUN_THUMBNAIL_VIEW] in {
        call.args[0] for call in hass.http.register_view.call_args_list
    }
    registered_paths = {
        config.url_path
        for config in hass.http.async_register_static_paths.await_args.args[0]
    }
    assert MATIC_MAP_STUDIO_V4_ROOT_PATH in registered_paths
    assert MATIC_ICONS_PATH in registered_paths
    assert MATIC_ICONS_PATH in hass.data[frontend.DATA_EXTRA_MODULE_URL]
    assert registered_paths == {MATIC_MAP_STUDIO_V4_ROOT_PATH, MATIC_ICONS_PATH}
    assert hass.data[frontend.DATA_EXTRA_MODULE_URL] == {MATIC_ICONS_PATH}
    panel = hass.data[frontend.DATA_PANELS]["matic-map"]
    safe_area_options = {} if legacy_panel_api else {"handle_safe_area": True}
    panel_registration.assert_awaited_once_with(
        hass,
        frontend_url_path="matic-map",
        webcomponent_name=MATIC_MAP_PANEL_ELEMENT,
        sidebar_title="Matic Map",
        sidebar_icon="matic:robot",
        module_url=MATIC_MAP_STUDIO_V4_PATH,
        require_admin=True,
        **safe_area_options,
    )
    assert panel.require_admin is True
    assert panel.sidebar_icon == "matic:robot"
    assert panel.config_panel_domain is None
    assert panel.config["_panel_custom"]["name"] == MATIC_MAP_PANEL_ELEMENT
    assert panel.config["_panel_custom"]["module_url"] == MATIC_MAP_STUDIO_V4_PATH
    assert panel.config["_panel_custom"]["handle_safe_area"] is not legacy_panel_api
    assert hass.services.async_register.call_count == 22
    assert hass.data[DOMAIN][DATA_PLAN_MANAGER] is history.return_value
    assert hass.data[DOMAIN][DATA_LLM_API].id == "matic_robot_operations"
    assert "classic_module_url" not in panel.config


@pytest.mark.parametrize("native_history_error", [False, True])
@pytest.mark.parametrize("recovering_run", [False, True])
@pytest.mark.parametrize("recovering_stop", [False, True])
@pytest.mark.parametrize("initial_floor_present", [False, True])
async def test_setup_starts_the_session_before_forwarding_platforms(
    robot_session: SimpleNamespace,
    native_history_error: bool,
    recovering_run: bool,
    recovering_stop: bool,
    initial_floor_present: bool,
) -> None:
    plans = MagicMock()
    plans.ledger.async_set_native_cleanings_enabled = AsyncMock()
    plans.recovery.recovery_run.return_value = {} if recovering_run else None
    plans.control.pending_stop_run_id.return_value = "run" if recovering_stop else None
    plans.catalog.areas.return_value = {}
    plans.catalog.async_upgrade_area_bindings = AsyncMock(
        return_value=AreaBindingUpgradeResult(0, False)
    )
    plans.ledger.async_process_native_history = AsyncMock(return_value=False)
    plans.control.robot_generation.return_value = 3
    track_workspace_entry = MagicMock()
    photo_source = SimpleNamespace(activate_entry=MagicMock())

    async def forward(_entry, _platforms) -> None:
        robot_session.async_start.assert_awaited_once_with()

    firmware_tracker = MagicMock()
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="America/Los_Angeles"),
        config_entries=SimpleNamespace(
            async_forward_entry_setups=AsyncMock(side_effect=forward)
        ),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: plans,
                DATA_FIRMWARE_TRACKER: firmware_tracker,
                DATA_PHOTO_ATTACHMENT_SOURCE: photo_source,
                DATA_WORKSPACE_SOCKET: SimpleNamespace(
                    track_entry=track_workspace_entry
                ),
            }
        },
    )
    entry = _entry()
    tasks: list[str] = []

    def capture_task(_hass, target, name):
        tasks.append(name)
        target.close()

    entry.async_create_background_task.side_effect = capture_task
    client = MagicMock()
    client.async_get_cleaning_session_snapshot = AsyncMock(
        side_effect=CannotConnectError("history unavailable")
        if native_history_error
        else None,
        return_value=((), "history-revision"),
    )
    floor_plan = (
        FloorPlan(42, "synthetic-partition", b"synthetic-partition", ())
        if initial_floor_present
        else None
    )
    robot_session.floor.value = floor_plan
    robot_session.history.value = CleaningHistory(revision="history-revision")
    slam_map = SimpleNamespace(
        async_load=AsyncMock(),
        set_expected_mission_id=MagicMock(),
        async_prime=AsyncMock(),
        async_collect=MagicMock(),
        async_shutdown=AsyncMock(),
        async_add_listener=MagicMock(return_value=MagicMock()),
        floor_plan_is_current=MagicMock(return_value=True),
        mission_identity=None,
    )
    slam_history = SimpleNamespace(
        async_load=AsyncMock(),
        async_expire_trash_until_closed=AsyncMock(),
        async_shutdown=AsyncMock(),
    )

    with (
        patch(
            "custom_components.matic_robot.MaticHermesClient", return_value=client
        ) as client_factory,
        patch("custom_components.matic_robot.HermesCredential.from_storage") as decode,
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch("custom_components.matic_robot.RunTrails", autospec=True) as run_trails,
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        patch(
            "custom_components.matic_robot.WifiSurveyStore", return_value=_wifi_survey()
        ),
        patch(
            "custom_components.matic_robot.async_collect_slam_history",
            return_value=MagicMock(),
        ) as collect_history,
        patch("custom_components.matic_robot.session_listeners.async_listen") as listen,
        patch(
            "custom_components.matic_robot.floor_sync.async_sync_custom_area_issue"
        ) as sync_area_issue,
        patch(
            "custom_components.matic_robot.dt_util.now",
            return_value=datetime(2026, 7, 14, tzinfo=UTC),
        ),
    ):
        assert await async_setup_entry(hass, entry) is True

    # Client activity reaches the bus through one throttle the entry closes.
    observe = client_factory.call_args.kwargs["observation_callback"]
    assert isinstance(observe.__self__, ActivityEvents)
    assert entry.async_on_unload.call_args_list[0].args[0] == (
        observe.__self__.async_close
    )
    assert client_factory.call_args.kwargs["timezone_identifier"] == (
        "America/Los_Angeles"
    )
    decode.assert_called_once_with("test-credential")
    hass.config_entries.async_forward_entry_setups.assert_awaited_once_with(
        entry, PLATFORMS
    )
    listen.assert_called_once_with(hass, entry, robot_session, firmware_tracker)
    track_workspace_entry.assert_called_once_with(entry)
    photo_source.activate_entry.assert_called_once_with(entry.entry_id)
    slam_map.async_prime.assert_awaited_once_with(client)
    plans.control.activate_robot.assert_called_once_with("synthetic-serial")
    plans.catalog.async_upgrade_area_bindings.assert_awaited_once_with(
        "synthetic-serial", floor_plan
    )
    plans.ledger.async_set_native_cleanings_enabled.assert_awaited_once_with(
        "synthetic-serial", True
    )
    update_options = entry.add_update_listener.call_args.args[0]
    await update_options(
        hass,
        SimpleNamespace(data=entry.data, options={"include_native_cleanings": False}),
    )
    plans.ledger.async_set_native_cleanings_enabled.assert_awaited_with(
        "synthetic-serial", False
    )
    if native_history_error:
        plans.ledger.async_process_native_history.assert_not_awaited()
    else:
        plans.ledger.async_process_native_history.assert_awaited_once_with(
            "synthetic-serial",
            floor_plan,
            (),
            coverage_verifier=client.async_confirm_coverage_receipt,
            current_floor_plan=ANY,
            generation=3,
        )
    # Setup's history read counts only with a floor to import it into;
    # otherwise the sync imports that revision again in the background.
    imported = not native_history_error and initial_floor_present
    assert tasks == [
        "matic_robot saved map trash expiry",
        *(
            ["matic_robot managed run recovery"]
            if recovering_run or recovering_stop
            else []
        ),
        "matic_robot photo collector",
        *([] if imported else ["matic_robot native history"]),
        "matic_robot photographic map collector",
        "matic_robot map history collector",
        "matic_robot Wi-Fi survey collector",
    ]
    plans.ledger.pending_native_reconciliation.assert_called_once_with(
        "synthetic-serial"
    )
    runtime = entry.runtime_data
    assert runtime.client is client
    assert runtime.session is robot_session
    assert runtime.slam_map is slam_map
    assert runtime.slam_history is slam_history
    assert runtime.run_trails is run_trails.return_value
    assert runtime.firmware_tracker is firmware_tracker
    assert isinstance(runtime.photos, RobotPhotoStore)
    slam_map.async_load.assert_awaited_once()
    slam_map.async_add_listener.assert_called_once()
    assert slam_map.set_expected_mission_id.call_args.args == (
        floor_plan.mission_id if floor_plan is not None else None,
    )
    slam_history.async_load.assert_awaited_once()
    run_trails.return_value.async_load.assert_awaited_once_with()
    slam_map.async_collect.assert_called_once_with(client)
    collect_history.assert_called_once()
    # Each pose extends the trail, and a state change can close a run.
    trail_callback = robot_session.poses._listeners[0]
    assert trail_callback.func is observe_trail
    assert trail_callback.args == (runtime,)
    assert trail_callback in robot_session.state._listeners
    sync_area_issue.assert_called_once_with(hass, "entry", {}, floor_plan)


@pytest.mark.parametrize(
    ("binding_version", "expected_version"),
    [
        (SCOPED_MAP_BINDING_VERSION, SCOPED_MAP_BINDING_VERSION),
        (
            SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        ),
    ],
)
async def test_setup_listener_keeps_current_area_quiet_on_safe_map_refresh(
    hass, robot_session: SimpleNamespace, binding_version: int, expected_version: int
) -> None:
    """The real setup listener must not alert/rebind current areas on safe churn."""
    serial = "synthetic-serial"
    room_boundary = (
        ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
        if binding_version == SCOPED_MAP_BINDING_VERSION
        else tuple(
            (
                0.5 + 0.45 * math.cos(2 * math.pi * index / 320),
                0.5 + 0.45 * math.sin(2 * math.pi * index / 320),
            )
            for index in range(320)
        )
    )
    original = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "room", b"room", room_boundary),),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
    current_area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Current zone",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_area(original, circles),
    }
    assert current_area["map_binding"]["version"] == expected_version
    if binding_version == SCOPED_MAP_BINDING_VERSION:
        anchors = current_area["map_binding"]["translation_room_anchors"]
        assert anchors
        assert all("boundary_mm" in anchor for anchor in anchors)

    # This separately retained reviewable legacy area keeps the
    # binding-upgrade work pending, so the actual setup callback schedules the
    # manager operation while the current binding is checked for stability.
    old_frame = replace(
        original,
        rooms=tuple(
            replace(
                room,
                boundary=tuple((x + 0.1, y) for x, y in room.boundary),
            )
            for room in original.rooms
        ),
    )
    legacy_circles = [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    legacy_area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Needs review",
        "circles": legacy_circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": {
            key: value
            for key, value in binding_for_area(old_frame, legacy_circles).items()
            if key
            not in {"translation_invariant_geometry_sha256", "translation_room_anchors"}
        },
    }
    legacy_area["map_binding"]["version"] = 4

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    robot = manager.repository.robot(serial)
    robot["areas"].update({"current": current_area, "legacy": legacy_area})
    robot["plans"]["area-plan"] = {
        "id": "area-plan",
        "name": "Area plan",
        "enabled": True,
        "run_behavior": "saved_order",
        "rooms": [],
        "entries": [
            {
                "kind": "area",
                "area_id": "current",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
        "return_to_base": True,
    }
    current_record = current_area.copy()
    current_binding = current_area["map_binding"].copy()

    plan_unsubscribe = MagicMock()
    # The first read has no usable floor, leaving the legacy binding upgrade
    # pending until the safe map refresh is observed.
    manager.repository.async_add_listener = MagicMock(return_value=plan_unsubscribe)
    scheduled_upgrades = []

    def capture_task(_hass, target, name):
        if name == "matic_robot custom area binding upgrade":
            scheduled_upgrades.append(target)
        else:
            target.close()

    entry = _entry()
    entry.async_create_background_task.side_effect = capture_task
    client = MagicMock()
    client.async_get_cleaning_session_snapshot = AsyncMock(
        return_value=((), "history-revision")
    )
    client.async_send_command = AsyncMock()
    slam_map = SimpleNamespace(
        async_load=AsyncMock(),
        set_expected_mission_id=MagicMock(),
        async_prime=AsyncMock(),
        async_collect=MagicMock(),
        async_shutdown=AsyncMock(),
        async_add_listener=MagicMock(return_value=MagicMock()),
        floor_plan_is_current=MagicMock(return_value=True),
        mission_identity=None,
    )
    slam_history = SimpleNamespace(
        async_load=AsyncMock(),
        async_expire_trash_until_closed=AsyncMock(),
        async_shutdown=AsyncMock(),
    )
    hass.data.setdefault(DOMAIN, {})[DATA_PLAN_MANAGER] = manager
    hass.data[DOMAIN] |= {
        DATA_FIRMWARE_TRACKER: MagicMock(),
        DATA_WORKSPACE_SOCKET: MagicMock(),
    }
    with (
        patch.object(
            hass.config_entries,
            "async_forward_entry_setups",
            new_callable=AsyncMock,
        ),
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch("custom_components.matic_robot.HermesCredential.from_storage"),
        patch("custom_components.matic_robot.session_listeners.async_listen"),
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch("custom_components.matic_robot.RunTrails", autospec=True),
        patch(
            "custom_components.matic_robot.SlamHistoryStore", return_value=slam_history
        ),
        patch(
            "custom_components.matic_robot.WifiSurveyStore", return_value=_wifi_survey()
        ),
        patch(
            "custom_components.matic_robot.async_collect_slam_history",
            return_value=MagicMock(),
        ),
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create_issue,
    ):
        assert await async_setup_entry(hass, entry) is True
        refresh = replace(
            original,
            partition_protocol_id="refreshed-partition",
            partition_id_wire=b"refreshed-partition",
            rooms=(
                *original.rooms,
                Room(
                    "remote",
                    "Remote room",
                    "remote",
                    b"remote",
                    ((3.0, 0.0), (4.0, 0.0), (4.0, 1.0), (3.0, 1.0)),
                ),
            ),
        )
        # Simulate the reviewable legacy record being removed between startup
        # and the new-map notification. Its pending retry still exercises the
        # listener's real scheduling path, while the remaining current v5 area
        # is the only saved target whose notification behavior is measured.
        manager.repository.robot(serial)["areas"].pop("legacy")
        robot_session.floor.set(refresh)
        assert len(scheduled_upgrades) == 1
        await scheduled_upgrades.pop()
        # Another check of the same floor and another safe refresh must keep
        # the confirmed binding quiet without scheduling writes.
        manager.repository.async_add_listener.call_args.args[1]()
        later_refresh = replace(
            refresh,
            partition_protocol_id="later-partition",
            partition_id_wire=b"later-partition",
        )
        robot_session.floor.set(later_refresh)

    assert current_area == current_record
    assert current_area["map_binding"] == current_binding
    assert area_binding_status(current_area, later_refresh) is AreaBindingStatus.CURRENT
    create_issue.assert_not_called()
    # Startup persists the initial external-cleaning activation cutoff.
    assert manager.repository.store.async_save.await_count == 1
    preview = manager.planning.preview(
        serial,
        {room.id: room.name for room in later_refresh.rooms},
        "area-plan",
        floor_plan=later_refresh,
    )
    assert preview["valid"] is True
    assert [entry["area_id"] for entry in preview["entries"]] == ["current"]
    client.async_send_command.assert_not_awaited()


async def test_setup_closes_client_when_the_session_cannot_start(
    robot_session: SimpleNamespace,
) -> None:
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock()),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: MagicMock(),
                DATA_FIRMWARE_TRACKER: MagicMock(),
                DATA_WORKSPACE_SOCKET: MagicMock(),
            }
        },
    )
    entry = _entry()
    entry.data.pop(CONF_HERMES_CREDENTIAL)
    client = MagicMock(async_shutdown=AsyncMock())
    robot_session.async_start.side_effect = RuntimeError("offline")

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        pytest.raises(RuntimeError, match="offline"),
    ):
        await async_setup_entry(hass, entry)

    client.async_shutdown.assert_awaited_once_with()


async def test_revoked_credential_enters_reauthentication_before_setup(
    robot_session: SimpleNamespace,
) -> None:
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock()),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: MagicMock(),
                DATA_FIRMWARE_TRACKER: MagicMock(),
                DATA_WORKSPACE_SOCKET: MagicMock(),
            }
        },
    )
    entry = _entry()
    client = MagicMock(async_shutdown=AsyncMock())
    robot_session.async_start.side_effect = ConfigEntryAuthFailed("credential rejected")

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch("custom_components.matic_robot.HermesCredential.from_storage"),
        patch("custom_components.matic_robot.SlamMapStore") as slam_store,
        patch("custom_components.matic_robot.SlamHistoryStore") as history_store,
        patch("custom_components.matic_robot.WifiSurveyStore") as survey_store,
        pytest.raises(ConfigEntryAuthFailed, match="rejected"),
    ):
        await async_setup_entry(hass, entry)

    client.async_shutdown.assert_awaited_once_with()
    hass.config_entries.async_forward_entry_setups.assert_not_awaited()
    slam_store.assert_not_called()
    history_store.assert_not_called()
    survey_store.assert_not_called()


async def test_setup_closes_client_when_platform_forwarding_fails() -> None:
    plans = MagicMock()
    plans.ledger.async_set_native_cleanings_enabled = AsyncMock()
    plans.catalog.async_upgrade_area_bindings = AsyncMock(
        return_value=AreaBindingUpgradeResult(0, False)
    )
    plans.ledger.async_process_native_history = AsyncMock(return_value=False)
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(
            async_forward_entry_setups=AsyncMock(
                side_effect=RuntimeError("platform setup failed")
            )
        ),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: plans,
                DATA_FIRMWARE_TRACKER: MagicMock(),
                DATA_WORKSPACE_SOCKET: MagicMock(),
            }
        },
    )
    entry = _entry()
    client = MagicMock(async_shutdown=AsyncMock())
    client.async_get_cleaning_session_snapshot = AsyncMock(
        return_value=((), "history-revision")
    )
    slam_map = SimpleNamespace(
        async_load=AsyncMock(),
        set_expected_mission_id=MagicMock(),
        async_prime=AsyncMock(),
        async_collect=MagicMock(),
        async_shutdown=AsyncMock(),
    )
    slam_history = SimpleNamespace(
        async_load=AsyncMock(),
        async_expire_trash_until_closed=AsyncMock(),
        async_shutdown=AsyncMock(),
    )

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch("custom_components.matic_robot.HermesCredential.from_storage"),
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch("custom_components.matic_robot.RunTrails", autospec=True),
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        patch(
            "custom_components.matic_robot.WifiSurveyStore", return_value=_wifi_survey()
        ),
        pytest.raises(RuntimeError, match="platform setup failed"),
    ):
        await async_setup_entry(hass, entry)

    client.async_shutdown.assert_awaited_once_with()
    slam_map.async_shutdown.assert_awaited_once()
    slam_history.async_shutdown.assert_awaited_once()


@pytest.mark.parametrize("unload_ok", [True, False])
@pytest.mark.parametrize("disabled", [True, False])
@pytest.mark.parametrize("stopping", [True, False])
async def test_unload_closes_client_only_after_all_platforms_unload(
    unload_ok, disabled, stopping
) -> None:
    client = MagicMock()
    client.async_shutdown = AsyncMock()
    slam_map = SimpleNamespace(async_shutdown=AsyncMock())
    slam_history = SimpleNamespace(async_shutdown=AsyncMock())
    run_trails = SimpleNamespace(async_shutdown=AsyncMock())
    plans = SimpleNamespace(
        repository=SimpleNamespace(async_close_metadata_admission_and_wait=AsyncMock()),
        control=SimpleNamespace(
            async_cancel_and_wait=AsyncMock(),
            async_close_command_admission_and_wait=AsyncMock(),
            begin_command_teardown=MagicMock(),
            reopen_metadata_admission=MagicMock(),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(),
        recovery=SimpleNamespace(
            async_retire_recovery=AsyncMock(), recovery_run=MagicMock(return_value=None)
        ),
    )
    entry = SimpleNamespace(
        entry_id="entry",
        disabled_by="user" if disabled else None,
        data={CONF_SERIAL_NUMBER: "synthetic-serial"},
        runtime_data=SimpleNamespace(
            session=SimpleNamespace(async_stop=client.async_shutdown),
            slam_map=slam_map,
            slam_history=slam_history,
            run_trails=run_trails,
            wifi_survey=_wifi_survey(),
            cleaning_plans=plans,
        ),
    )
    scene_view = SimpleNamespace(clear_entry=MagicMock())
    floor_layers_view = SimpleNamespace(clear_entry=MagicMock())
    run_thumbnail_view = SimpleNamespace(clear_entry=MagicMock())
    photo_source = SimpleNamespace(
        activate_entry=MagicMock(), async_release_entry=AsyncMock()
    )
    from custom_components.matic_robot.frontend import (
        DATA_FLOOR_LAYERS_VIEW,
        DATA_RUN_THUMBNAIL_VIEW,
        DATA_SLAM_SCENE_VIEW,
    )

    hass = SimpleNamespace(
        is_stopping=stopping,
        config_entries=SimpleNamespace(
            async_unload_platforms=AsyncMock(return_value=unload_ok)
        ),
        data={
            DOMAIN: {DATA_PHOTO_ATTACHMENT_SOURCE: photo_source},
            DATA_SLAM_SCENE_VIEW: scene_view,
            DATA_FLOOR_LAYERS_VIEW: floor_layers_view,
            DATA_RUN_THUMBNAIL_VIEW: run_thumbnail_view,
        },
    )

    assert await async_unload_entry(hass, entry) is unload_ok
    plans.control.async_cancel_and_wait.assert_awaited_once_with(
        "synthetic-serial", preserve_run=not disabled
    )
    plans.control.begin_command_teardown.assert_called_once_with("synthetic-serial")
    plans.control.async_close_command_admission_and_wait.assert_awaited_once_with(
        "synthetic-serial"
    )
    plans.repository.async_close_metadata_admission_and_wait.assert_awaited_once_with(
        "synthetic-serial"
    )
    assert plans.control.reopen_metadata_admission.called is not unload_ok
    if disabled:
        plans.recovery.async_retire_recovery.assert_awaited_once_with(
            "synthetic-serial", "config_entry_unload"
        )
    else:
        plans.recovery.async_retire_recovery.assert_not_awaited()
    assert client.async_shutdown.called is unload_ok
    assert scene_view.clear_entry.called is unload_ok
    assert floor_layers_view.clear_entry.called is unload_ok
    assert run_thumbnail_view.clear_entry.called is unload_ok
    if unload_ok:
        photo_source.async_release_entry.assert_awaited_once_with("entry")
    else:
        photo_source.async_release_entry.assert_not_awaited()
    assert slam_map.async_shutdown.await_count == int(unload_ok)
    assert slam_history.async_shutdown.await_count == int(unload_ok)
    assert run_trails.async_shutdown.await_count == int(unload_ok)


async def test_unload_fences_external_command_before_managed_cleanup_wait(
    hass, monkeypatch
) -> None:
    """External dispatch closes synchronously while managed cleanup can settle."""
    from custom_components.matic_robot.frontend import (
        DATA_SLAM_SCENE_VIEW,
    )

    manager = CleaningPlanManager(hass)
    serial = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial)
    cleanup_started = asyncio.Event()
    release_cleanup = asyncio.Event()
    dispatched: list[str] = []

    async def hold_existing_cleanup(_serial: str, *, preserve_run: bool) -> None:
        assert preserve_run
        async with manager.control.managed_command(
            serial, token, teardown_cleanup=True
        ):
            cleanup_started.set()
            await release_cleanup.wait()

    manager.control.async_cancel_and_wait = hold_existing_cleanup
    client = SimpleNamespace(async_shutdown=AsyncMock())
    slam_map = SimpleNamespace(async_shutdown=AsyncMock())
    slam_history = SimpleNamespace(async_shutdown=AsyncMock())
    run_trails = SimpleNamespace(async_shutdown=AsyncMock())
    entry = SimpleNamespace(
        entry_id="entry",
        disabled_by=None,
        data={CONF_SERIAL_NUMBER: serial},
        runtime_data=SimpleNamespace(
            cleaning_plans=manager,
            session=SimpleNamespace(async_stop=client.async_shutdown),
            slam_map=slam_map,
            slam_history=slam_history,
            run_trails=run_trails,
            wifi_survey=_wifi_survey(),
        ),
    )
    scene_view = SimpleNamespace(clear_entry=MagicMock())
    hass.data[DATA_SLAM_SCENE_VIEW] = scene_view
    monkeypatch.setattr(
        hass.config_entries,
        "async_unload_platforms",
        AsyncMock(return_value=True),
    )

    unload = asyncio.create_task(async_unload_entry(hass, entry))
    external: asyncio.Task[None] | None = None
    try:
        await asyncio.wait_for(cleanup_started.wait(), timeout=3)

        async def external_dispatch() -> None:
            async with manager.control.external_command(serial):
                dispatched.append("sent")

        external = asyncio.create_task(external_dispatch())
        await asyncio.sleep(0)
        assert external.done()
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await external
        assert dispatched == []
        release_cleanup.set()
    finally:
        release_cleanup.set()
        await asyncio.gather(unload, return_exceptions=True)
        if external is not None and not external.done():
            external.cancel()
            await asyncio.gather(external, return_exceptions=True)

    client.async_shutdown.assert_awaited_once()
    with pytest.raises(HomeAssistantError, match="unavailable during unload"):
        manager.control.require_command_admission(serial)


async def test_teardown_allows_only_existing_managed_token_cleanup(
    hass, monkeypatch
) -> None:
    """The staged fence preserves cleanup for the current managed owner only."""
    manager = CleaningPlanManager(hass)
    serial = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial)
    persistence_started = asyncio.Event()
    release_persistence = asyncio.Event()
    dispatched: list[str] = []

    async def delay_reconciliation_removal(_serial: str, _removed: bool) -> None:
        persistence_started.set()
        await release_persistence.wait()

    monkeypatch.setattr(
        manager.control,
        "async_persist_reconciliation_removal",
        delay_reconciliation_removal,
    )

    async def managed_cleanup() -> None:
        async with manager.control.managed_command(
            serial, token, teardown_cleanup=True
        ):
            dispatched.append("managed")

    command = asyncio.create_task(managed_cleanup())
    try:
        await asyncio.wait_for(persistence_started.wait(), timeout=3)
        manager.control.begin_command_teardown(serial)
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            manager.control.begin_managed_motion(serial)
        release_persistence.set()
        await command
        assert dispatched == ["managed"]
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            async with manager.control.managed_command(serial, token):
                dispatched.append("clean")
        assert dispatched == ["managed"]
    finally:
        release_persistence.set()
        if not command.done():
            command.cancel()
            await asyncio.gather(command, return_exceptions=True)


async def test_failed_enabled_unload_reschedules_recovery(hass) -> None:
    """A failed platform unload must not strand a preserved managed run."""
    plans = SimpleNamespace(
        repository=SimpleNamespace(async_close_metadata_admission_and_wait=AsyncMock()),
        control=SimpleNamespace(
            async_cancel_and_wait=AsyncMock(),
            async_close_command_admission_and_wait=AsyncMock(),
            begin_command_teardown=MagicMock(),
            reopen_metadata_admission=MagicMock(),
        ),
        ledger=SimpleNamespace(),
        recovery=SimpleNamespace(
            recovery_run=MagicMock(return_value={"run_id": "run"}),
            async_retire_recovery=AsyncMock(),
        ),
    )
    target_tasks = []

    def capture_task(_hass, target, name):
        target_tasks.append((target, name))
        target.close()

    entry = SimpleNamespace(
        disabled_by=None,
        data={CONF_SERIAL_NUMBER: "serial"},
        entry_id="entry",
        async_create_background_task=MagicMock(side_effect=capture_task),
        runtime_data=SimpleNamespace(cleaning_plans=plans),
    )
    hass.config_entries.async_unload_platforms = AsyncMock(return_value=False)
    await async_unload_entry(hass, entry)
    plans.control.reopen_metadata_admission.assert_called_once_with("serial")
    entry.async_create_background_task.assert_called_once()
    assert target_tasks[0][1] == f"{DOMAIN} managed run recovery after unload failure"


async def test_failed_unload_reschedules_pending_stop_settlement(hass) -> None:
    plans = SimpleNamespace(
        repository=SimpleNamespace(async_close_metadata_admission_and_wait=AsyncMock()),
        control=SimpleNamespace(
            async_cancel_and_wait=AsyncMock(),
            async_close_command_admission_and_wait=AsyncMock(),
            begin_command_teardown=MagicMock(),
            reopen_metadata_admission=MagicMock(),
            pending_stop_run_id=MagicMock(return_value="run"),
        ),
        ledger=SimpleNamespace(),
        recovery=SimpleNamespace(
            recovery_run=MagicMock(return_value=None), async_retire_recovery=AsyncMock()
        ),
    )
    target_tasks = []

    def capture_task(_hass, target, name):
        target_tasks.append((target, name))
        target.close()

    entry = SimpleNamespace(
        disabled_by=None,
        data={CONF_SERIAL_NUMBER: "serial"},
        entry_id="entry",
        async_create_background_task=MagicMock(side_effect=capture_task),
        runtime_data=SimpleNamespace(cleaning_plans=plans),
    )
    hass.config_entries.async_unload_platforms = AsyncMock(return_value=False)
    await async_unload_entry(hass, entry)
    plans.control.reopen_metadata_admission.assert_called_once_with("serial")
    entry.async_create_background_task.assert_called_once()
    assert target_tasks[0][1] == f"{DOMAIN} managed run recovery after unload failure"


async def test_failed_shutdown_unload_does_not_resume_recovery(hass) -> None:
    plans = SimpleNamespace(
        repository=SimpleNamespace(async_close_metadata_admission_and_wait=AsyncMock()),
        control=SimpleNamespace(
            async_cancel_and_wait=AsyncMock(),
            async_close_command_admission_and_wait=AsyncMock(),
            begin_command_teardown=MagicMock(),
            reopen_metadata_admission=MagicMock(),
            pending_stop_run_id=MagicMock(return_value="run"),
        ),
        ledger=SimpleNamespace(),
        recovery=SimpleNamespace(
            recovery_run=MagicMock(return_value={"run_id": "run"}),
            async_retire_recovery=AsyncMock(),
        ),
    )
    entry = SimpleNamespace(
        disabled_by=None,
        data={CONF_SERIAL_NUMBER: "serial"},
        entry_id="entry",
        async_create_background_task=MagicMock(),
        runtime_data=SimpleNamespace(cleaning_plans=plans),
    )
    hass.is_stopping = True
    hass.config_entries.async_unload_platforms = AsyncMock(return_value=False)
    await async_unload_entry(hass, entry)
    plans.control.reopen_metadata_admission.assert_called_once_with("serial")
    entry.async_create_background_task.assert_not_called()


@pytest.mark.parametrize("with_plans", [True, False])
async def test_remove_entry_erases_firmware_history(with_plans) -> None:
    tracker = SimpleNamespace(async_remove_robot=AsyncMock())
    plans = SimpleNamespace(async_remove_robot=AsyncMock())
    scene_view = SimpleNamespace(clear_entry=MagicMock())
    from custom_components.matic_robot.frontend import DATA_SLAM_SCENE_VIEW

    hass = SimpleNamespace(
        data={
            DOMAIN: {
                DATA_FIRMWARE_TRACKER: tracker,
                **({DATA_PLAN_MANAGER: plans} if with_plans else {}),
            },
            DATA_SLAM_SCENE_VIEW: scene_view,
        }
    )
    entry = SimpleNamespace(entry_id="entry", data={CONF_SERIAL_NUMBER: "serial"})
    slam_map = SimpleNamespace(async_remove=AsyncMock())
    slam_history = SimpleNamespace(async_remove=AsyncMock())

    temporary_plans = SimpleNamespace(async_remove_robot=AsyncMock())
    manager_to_remove = plans if with_plans else temporary_plans
    with (
        patch(
            "custom_components.matic_robot.async_get_plan_manager",
            return_value=manager_to_remove,
        ) as get_plan_manager,
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch("custom_components.matic_robot.RunTrails", autospec=True) as run_trails,
        patch(
            "custom_components.matic_robot.SlamHistoryStore", return_value=slam_history
        ),
        patch(
            "custom_components.matic_robot.WifiSurveyStore", return_value=_wifi_survey()
        ),
        patch(
            "custom_components.matic_robot.async_delete_custom_area_issue"
        ) as delete_area_issue,
        patch(
            "custom_components.matic_robot.async_delete_robot_alert_issues"
        ) as delete_alert_issues,
        patch("custom_components.matic_robot.async_remove_floor_catalogs") as catalogs,
    ):
        await async_remove_entry(hass, entry)

    tracker.async_remove_robot.assert_awaited_once_with("entry")
    get_plan_manager.assert_awaited_once_with(hass)
    manager_to_remove.async_remove_robot.assert_awaited_once_with("serial")
    if with_plans:
        assert hass.data[DOMAIN][DATA_PLAN_MANAGER] is plans
    scene_view.clear_entry.assert_called_once_with("entry")
    slam_map.async_remove.assert_awaited_once()
    slam_history.async_remove.assert_awaited_once()
    run_trails.assert_called_once_with(hass, "entry")
    run_trails.return_value.async_remove.assert_awaited_once_with()
    delete_area_issue.assert_called_once_with(hass, "entry")
    delete_alert_issues.assert_called_once_with(hass, "entry")
    catalogs.assert_awaited_once_with(hass, "entry")

    bare = SimpleNamespace(data={})
    bare_plans = SimpleNamespace(async_remove_robot=AsyncMock())
    with (
        patch(
            "custom_components.matic_robot.async_get_plan_manager",
            return_value=bare_plans,
        ) as bare_get_plan_manager,
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch("custom_components.matic_robot.RunTrails", autospec=True) as run_trails,
        patch(
            "custom_components.matic_robot.SlamHistoryStore", return_value=slam_history
        ),
        patch(
            "custom_components.matic_robot.WifiSurveyStore", return_value=_wifi_survey()
        ),
        patch(
            "custom_components.matic_robot.async_delete_custom_area_issue"
        ) as delete_bare_area_issue,
        patch("custom_components.matic_robot.async_delete_robot_alert_issues"),
        patch("custom_components.matic_robot.async_remove_floor_catalogs"),
    ):
        await async_remove_entry(bare, entry)

    bare_get_plan_manager.assert_awaited_once_with(bare)
    bare_plans.async_remove_robot.assert_awaited_once_with("serial")
    delete_bare_area_issue.assert_called_once_with(bare, "entry")


async def test_remove_entry_waits_for_published_plan_manager_load(hass) -> None:
    manager = SimpleNamespace(async_remove_robot=AsyncMock())
    load_started = asyncio.Event()
    finish_load = asyncio.Event()

    async def get_manager(_hass):
        load_started.set()
        await finish_load.wait()
        return manager

    hass.data.setdefault(DOMAIN, {})[DATA_PLAN_MANAGER] = manager
    entry = SimpleNamespace(entry_id="entry", data={CONF_SERIAL_NUMBER: "serial"})
    slam_map = SimpleNamespace(async_remove=AsyncMock())
    slam_history = SimpleNamespace(async_remove=AsyncMock())
    with (
        patch(
            "custom_components.matic_robot.async_get_plan_manager",
            side_effect=get_manager,
        ),
        patch("custom_components.matic_robot.clear_slam_scene_cache"),
        patch("custom_components.matic_robot.async_delete_custom_area_issue"),
        patch("custom_components.matic_robot.async_delete_robot_alert_issues"),
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch("custom_components.matic_robot.RunTrails", autospec=True),
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        patch(
            "custom_components.matic_robot.WifiSurveyStore", return_value=_wifi_survey()
        ),
    ):
        removing = asyncio.create_task(async_remove_entry(hass, entry))
        await load_started.wait()
        manager.async_remove_robot.assert_not_awaited()
        finish_load.set()
        await removing

    manager.async_remove_robot.assert_awaited_once_with("serial")
