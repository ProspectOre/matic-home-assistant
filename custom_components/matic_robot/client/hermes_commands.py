"""Validated robot commands and confirmation readback."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import struct
from collections import Counter
from collections.abc import (
    Awaitable,
    Callable,
    Sequence,
)
from time import monotonic
from uuid import UUID, uuid4

from google.protobuf.message import DecodeError

from .commands import (
    CleaningMode,
    CoverageSetting,
    CoverageUpdateGoal,
    QueueAction,
    QueueChangeError,
    UserCommand,
    encode_coverage_command,
    encode_coverage_goal_update,
    encode_custom_coverage_command,
    encode_go_to_room_command,
    encode_mission_id,
    encode_mixed_coverage_commands,
    encode_redo_coverage_command,
    encode_sink_summon_command,
    encode_user_command,
    queue_start_visit,
    requeue_coverage_goals,
)
from .coverage_goals import (
    CoveragePlanGoal,
    coverage_command_goal_signatures,
    coverage_plan_goal_signatures,
    coverage_plan_goals,
    coverage_plan_lacks_active_goals,
    coverage_readback_matches,
)
from .coverage_receipts import (
    CoverageReceipt,
    coverage_floor_hash,
    make_coverage_receipt,
    native_session_hash,
    receipt_matches_history,
    receipt_matches_plan,
)
from .exceptions import (
    CannotConnectError,
    CoverageGuardError,
    CoverageGuardReason,
    MaticError,
    SinkLocationUnavailableError,
)
from .floor_plan import room_name_key
from .hermes_collections import HermesCollections
from .hermes_connection import HermesConnection
from .hermes_reads import HermesReads
from .models import (
    FloorPlan,
    Room,
)
from .telemetry import (
    decode_binary_state,
    decode_deep_mop_state,
    decode_water_flow_factor,
)
from .wifi_status import decode_wifi_status, wifi_scan_block
from .wire import (
    uuid_string,
)

_LOGGER = logging.getLogger(__name__)
_WIFI_SCAN_RESULT_TIMEOUT_SECONDS = 8.0
_WIFI_SCAN_RESULT_INTERVAL_SECONDS = 1.0
_WIFI_SCAN_SETTLE_READS = 2
_COVERAGE_START_READBACK_TIMEOUT = 30.0
_MIXED_COVERAGE_READBACK_TIMEOUT = 8.0
_MIXED_COVERAGE_READBACK_INTERVAL = 0.5
_MIXED_READBACK_DELTA_LIMIT = 32
_QUEUE_READBACK_TIMEOUT = 45.0
_QUEUE_READBACK_INTERVAL = 2.0
_BINARY_SETTING_STATE_PROPERTIES = {
    "child_lock": "child_lock_enabled_state",
    "pet_waste": "petwaste_enabled_state",
    "voice": "voice_enabled_state",
}
_SETTING_READBACK_TIMEOUT_SECONDS = 8.0
_SETTING_READBACK_INTERVAL_SECONDS = 0.25
_BINARY_SETTING_CHANNELS = {
    "child_lock": "child_lock_enabled_command",
    "pet_waste": "petwaste_enabled_command",
    "voice": "voice_enabled_command",
}


def _queue_start_index(plan: Sequence[CoveragePlanGoal], current_region: str) -> int:
    """Return the plan index where the current room's last visit begins."""
    visits: list[tuple[str, list[int]]] = []
    for index, goal in enumerate(plan):
        if visits and visits[-1][0] == goal.region_id:
            visits[-1][1].append(index)
        else:
            visits.append((goal.region_id, [index]))
    return visits[queue_start_visit(visits, current_region)][1][0]


def _region_order(goals: Sequence[CoverageUpdateGoal | CoveragePlanGoal]) -> list[str]:
    order: list[str] = []
    for goal in goals:
        if not order or order[-1] != goal.region_id:
            order.append(goal.region_id)
    return order


def _queue_readback_matches(
    sent: Sequence[CoverageUpdateGoal],
    held: Sequence[CoveragePlanGoal],
    *,
    dropped: set[str],
    expected_order: list[str],
) -> bool:
    """Match the plan after a queue change by round IDs, specs and room order.

    The robot lists a room's behaviors in its own order and may leave out the
    last floor mop behavior, so the check compares rooms, not goal positions.
    """
    held_rounds = {goal.round_id: goal.signature for goal in held}
    if dropped & held_rounds.keys():
        return False
    for goal in sent:
        signature = held_rounds.get(goal.round_id)
        if signature is None:
            if (goal.floor, goal.mode, goal.behavior) != (0, 1, 3):
                return False
            continue
        # Heavy Duty vacuum and double-pass mop read back as setting 3.
        region, setting, floor, mode, behavior = signature
        if (region, floor, mode, behavior) != (
            goal.region_id,
            goal.floor,
            goal.mode,
            goal.behavior,
        ) or (
            setting != goal.setting
            and (setting, goal.setting, mode)
            not in {
                (3, 0, 0),
                (3, 1, 1),
            }
        ):
            return False
    sent_rounds = {goal.round_id for goal in sent}
    return (
        _region_order([goal for goal in held if goal.round_id in sent_rounds])
        == expected_order
    )


def _log_mixed_readback_timeout(
    expected: Counter[tuple[str, int, int, int, int]],
    actual: Counter[tuple[str, int, int, int, int]] | None,
    *,
    stage: str,
    malformed: bool,
) -> None:
    """Describe bounded goal differences using attempt-local room ordinals."""
    if not _LOGGER.isEnabledFor(logging.DEBUG):
        return
    observed = actual if actual is not None else Counter()
    rooms: dict[str, int] = {}
    for region, *_ in (*expected, *observed):
        if region not in rooms:
            rooms[region] = len(rooms) + 1

    def delta(
        goals: Counter[tuple[str, int, int, int, int]],
    ) -> list[tuple[int, int, int, int, int, int]]:
        return [
            (rooms[region], setting, floor, mode, behavior, count)
            for (region, setting, floor, mode, behavior), count in list(goals.items())[
                :_MIXED_READBACK_DELTA_LIMIT
            ]
        ]

    missing = expected - observed
    unexpected = observed - expected
    _LOGGER.debug(
        "Mixed coverage readback timed out: stage=%s sample=%s "
        "expected_count=%s actual_count=%s "
        "missing=%s missing_omitted=%s unexpected=%s unexpected_omitted=%s; "
        "goal tuples=(room_ordinal, setting, floor, mode, behavior, count)",
        stage,
        "malformed" if malformed else "unobserved" if actual is None else "observed",
        expected.total(),
        actual.total() if actual is not None else None,
        delta(missing),
        max(0, len(missing) - _MIXED_READBACK_DELTA_LIMIT),
        delta(unexpected),
        max(0, len(unexpected) - _MIXED_READBACK_DELTA_LIMIT),
    )


def _floor_command_identity(floor: FloorPlan) -> tuple[object, ...]:
    """Identify the native floor/partition/room set bound to one command."""
    return (
        floor.mission_id,
        floor.partition_protocol_id,
        floor.partition_id_wire,
        frozenset((room.id, room.protocol_id, room.id_wire) for room in floor.rooms),
    )


class HermesCommands:
    """Own commands behavior for one robot session."""

    def __init__(
        self,
        connection: HermesConnection,
        collections: HermesCollections,
        reads: HermesReads,
    ) -> None:
        self._connection = connection
        self._collections = collections
        self._reads = reads

    async def async_send_user_command(
        self,
        command: UserCommand,
        *,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Send one live-verified command through the authenticated user channel."""
        payload = encode_user_command(command)
        _LOGGER.debug("Requesting Matic user command %s", command.name)
        await self._connection._async_send_user_payload(
            payload, command_name=command.name, on_transmitted=on_transmitted
        )

    async def _async_check_idle_session_revision(self, expected: str | None) -> None:
        if expected is not None:
            try:
                current = await self._reads.async_get_idle_cleaning_session_revision()
            except MaticError as err:
                raise CoverageGuardError(
                    CoverageGuardReason.IDENTITY_UNAVAILABLE
                ) from err
            if current != expected:
                raise CoverageGuardError(CoverageGuardReason.IDENTITY_CHANGED)

    async def _async_require_idle_native_session(self) -> bytes:
        """Require stable, observable idle native state before managed coverage."""
        baseline_identity = await self._reads.async_get_cleaning_session_identity()
        if baseline_identity is None:
            raise CoverageGuardError(CoverageGuardReason.IDENTITY_UNAVAILABLE)
        active = await self._reads.async_get_active_cleaning_session_state()
        if active is None:
            raise CoverageGuardError(CoverageGuardReason.ACTIVITY_UNAVAILABLE)
        if active:
            raise CoverageGuardError(CoverageGuardReason.NATIVE_SESSION_ACTIVE)
        if await self._reads.async_get_cleaning_session_identity() != baseline_identity:
            raise CoverageGuardError(CoverageGuardReason.IDENTITY_CHANGED)
        return baseline_identity

    async def async_get_sink_posture(self, floor_plan: FloorPlan) -> bytes:
        """Return this floor's saved sink posture, as the app stored it."""
        mission_key = encode_mission_id(floor_plan.mission_id)
        postures = [
            entry.value
            for entry in await self._collections.async_get_collection_entries(
                "sink_summon_locations"
            )
            if entry.key == mission_key and entry.value
        ]
        if not postures:
            raise SinkLocationUnavailableError(
                "No sink location is saved for the current floor"
            )
        return postures[-1]

    async def async_sink_summon(self, floor_plan: FloorPlan, posture: bytes) -> None:
        """Send the robot to a sink posture on this floor to await a refill."""
        await self._connection._async_send_user_payload(
            encode_sink_summon_command(
                mission_id=floor_plan.mission_id, posture=posture
            ),
            command_name="SINK_SUMMON",
        )

    async def async_go_to_room(self, floor_plan: FloorPlan, room: Room) -> None:
        """Send the robot to a room on this floor without cleaning it."""
        await self._connection._async_send_user_payload(
            encode_go_to_room_command(
                mission_id=floor_plan.mission_id,
                partition_id=floor_plan.partition_protocol_id,
                region_id=room.protocol_id,
            ),
            command_name="GO_TO_ROOM",
        )

    async def async_redo_clean(self, session_key: bytes) -> None:
        """Clean a finished session again, keyed by its native history key."""
        await self._connection._async_send_user_payload(
            encode_redo_coverage_command(session_key),
            command_name="REDO_COVERAGE",
        )

    async def async_change_queue(
        self,
        floor_plan: FloorPlan,
        action: QueueAction,
        room: Room,
        *,
        cleaning_mode: CleaningMode | None = None,
        coverage_setting: CoverageSetting | None = None,
    ) -> None:
        """Skip, bring forward or repeat a room in the clean that is running.

        Like the app's queue sheet, this resends the goals from the current
        room onward under the task's own session ID, then waits until the
        robot's plan holds every goal sent and none of the goals left out.
        """
        identity = await self._reads.async_get_cleaning_session_identity()
        active = await self._reads.async_get_active_cleaning_session_state()
        if not identity or active is not True:
            raise QueueChangeError("no_clean_running")
        try:
            session_id = uuid_string(identity)
        except DecodeError as err:
            raise MaticError("Native task identity cannot be read") from err
        state = await self._reads.async_get_state()
        area = room_name_key(state.current_area)
        current = [
            candidate.protocol_id
            for candidate in floor_plan.rooms
            if area is not None and room_name_key(candidate.name) == area
        ]
        if len(current) != 1:
            raise QueueChangeError("current_room_unknown")
        try:
            plan = coverage_plan_goals(
                await self._collections.async_get_property("coverage_plan")
            )
        except DecodeError as err:
            raise QueueChangeError("plan_unreadable") from err
        goals = requeue_coverage_goals(
            [CoverageUpdateGoal(goal.round_id, *goal.signature) for goal in plan],
            action=action,
            current_region=current[0],
            target_region=room.protocol_id,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
        )
        payload = encode_coverage_goal_update(
            mission_id=floor_plan.mission_id,
            partition_id=floor_plan.partition_protocol_id,
            session_id=session_id,
            goals=goals,
        )
        start = _queue_start_index(plan, current[0])
        sent = {goal.round_id for goal in goals}
        dropped = {goal.round_id for goal in plan[start:]} - sent
        expected_order = _region_order(goals)
        if await self._reads.async_get_cleaning_session_identity() != identity:
            raise MaticError("Native mission changed before the queue change")
        await self._connection._async_send_user_payload(
            payload, command_name="UPDATE_QUEUE"
        )
        try:
            async with asyncio.timeout(_QUEUE_READBACK_TIMEOUT):
                while True:
                    await asyncio.sleep(_QUEUE_READBACK_INTERVAL)
                    if (
                        await self._reads.async_get_cleaning_session_identity()
                        != identity
                    ):
                        raise MaticError(
                            "Native mission changed during the queue change"
                        )
                    try:
                        held = coverage_plan_goals(
                            await self._collections.async_get_property("coverage_plan")
                        )
                    except DecodeError:
                        continue
                    if _queue_readback_matches(
                        goals, held, dropped=dropped, expected_order=expected_order
                    ):
                        return
        except TimeoutError as err:
            raise MaticError("Robot did not confirm the queue change") from err

    async def async_start_coverage(
        self,
        floor_plan: FloorPlan,
        region_ids: list[str],
        *,
        cleaning_mode: CleaningMode,
        coverage_setting: CoverageSetting,
        ordered: bool = False,
        require_settings_readback: bool = False,
        session_id: UUID | None = None,
        require_current: Callable[[], None] | None = None,
        expected_idle_revision: str | None = None,
    ) -> CoverageReceipt | None:
        """Start an exact normal-coverage command for local room IDs."""
        if require_settings_readback and session_id is None:
            session_id = uuid4()
        payload = encode_coverage_command(
            mission_id=floor_plan.mission_id,
            partition_id=floor_plan.partition_protocol_id,
            region_ids=region_ids,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
            ordered=ordered,
            session_id=session_id,
        )
        if require_settings_readback:
            baseline_identity = await self._async_require_idle_native_session()
        else:
            baseline_identity = None
        await self._async_check_idle_session_revision(expected_idle_revision)
        if require_current is not None:
            require_current()
        await self._connection._async_send_user_payload(
            payload, command_name="START_COVERAGE"
        )
        if require_settings_readback:
            assert baseline_identity is not None
            assert session_id is not None
            return await self._async_wait_for_coverage_readback(
                Counter(coverage_command_goal_signatures(payload)),
                floor_plan,
                pre_dispatch_identity=baseline_identity,
                expected_session_id=str(session_id),
                command_payload=payload,
            )
        return None

    async def async_start_mixed_coverage(
        self,
        floor_plan: FloorPlan,
        region_ids: list[str],
        settings: list[CoverageSetting],
        modes: list[CleaningMode],
        *,
        first_room_name: str,
        require_current: Callable[[], None],
        require_owned: Callable[[], None],
        prepare_stop: Callable[[], Awaitable[None]],
        rollback_stop: Callable[[], Awaitable[None]],
        on_recovery_stop_transmitted: Callable[[], None] | None = None,
        checkpoint_initial_session: Callable[[str], Awaitable[None]] | None = None,
        session_id: UUID | None = None,
        expected_idle_revision: str | None = None,
    ) -> CoverageReceipt | None:
        """Start then update only our accepted, still-current native mission.

        There is no retry/replay of either write. A partial dispatch failure
        stops only the exact generated session, never an external replacement.
        Managed callers durably checkpoint the generated identity before the
        initial write, so restart can fence this exact partial transaction.
        """
        commands = encode_mixed_coverage_commands(
            mission_id=floor_plan.mission_id,
            partition_id=floor_plan.partition_protocol_id,
            region_ids=region_ids,
            settings=settings,
            modes=modes,
            session_id=session_id,
        )
        expected_goals = Counter(coverage_command_goal_signatures(commands.update))
        require_current()
        baseline_identity = await self._async_require_idle_native_session()
        require_current()
        if checkpoint_initial_session is not None:
            await checkpoint_initial_session(
                hashlib.sha256(commands.session_id.encode("ascii")).hexdigest()
            )
            # Durable persistence can yield to an external native start. Revoke
            # this transaction before sending any bytes if ownership changed.
            if await self._async_require_idle_native_session() != baseline_identity:
                raise CoverageGuardError(CoverageGuardReason.IDENTITY_CHANGED)
        await self._async_check_idle_session_revision(expected_idle_revision)
        require_current()
        try:
            await self._connection._async_send_user_payload(
                commands.initial, command_name="START_COVERAGE"
            )
            async with asyncio.timeout(180):
                while True:
                    require_current()
                    identity = await self._reads.async_get_cleaning_session_identity()
                    state = await self._reads.async_get_state()
                    if identity and identity != baseline_identity:
                        if uuid_string(identity) != commands.session_id:
                            raise MaticError(
                                "Native mission changed before coverage update"
                            )
                    elif identity and identity == baseline_identity and state.cleaning:
                        # A retained completed identity is allowed at dispatch,
                        # but it cannot establish ownership of a newly active
                        # task. Fail closed if cleaning resumes under that key.
                        raise MaticError(
                            "Native mission changed before coverage update"
                        )
                    if (
                        identity
                        and identity != baseline_identity
                        and state.activity.value == "cleaning"
                        and room_name_key(state.current_area)
                        == room_name_key(first_room_name)
                    ):
                        break
                    await asyncio.sleep(2)
                latest = await self._reads.async_get_floor_plan()

                if _floor_command_identity(latest) != _floor_command_identity(
                    floor_plan
                ):
                    raise MaticError("Room map changed before coverage update")
                if await self._reads.async_get_cleaning_session_identity() != identity:
                    raise MaticError("Native mission changed before coverage update")
                state = await self._reads.async_get_state()
                if await self._reads.async_get_cleaning_session_identity() != identity:
                    raise MaticError("Native mission changed before coverage update")
                if state.activity.value != "cleaning" or room_name_key(
                    state.current_area
                ) != room_name_key(first_room_name):
                    raise MaticError("First room changed before coverage update")
                require_current()
                await self._connection._async_send_user_payload(
                    commands.update, command_name="UPDATE_COVERAGE"
                )
                if await self._reads.async_get_cleaning_session_identity() != identity:
                    raise MaticError("Native mission changed after coverage update")
                return await self._async_wait_for_mixed_coverage_readback(
                    expected_goals,
                    require_current=require_current,
                    expected_identity=identity,
                    command_payload=commands.update,
                    floor_plan=floor_plan,
                    expected_session_id=commands.session_id,
                )
        except Exception, asyncio.CancelledError:
            # Reconnection/read failure must not turn into an unowned STOP.
            try:
                require_owned()
                current = await self._reads.async_get_cleaning_session_identity()
                require_owned()
                if current and uuid_string(current) == commands.session_id:
                    stop_fence_prepared = False
                    stop_may_have_been_sent = False
                    try:
                        # A callback can install an in-memory fence before its
                        # persistence await fails, so arrange rollback first.
                        stop_fence_prepared = True
                        await prepare_stop()
                        require_owned()
                        if (
                            await self._reads.async_get_cleaning_session_identity()
                            != current
                        ):
                            raise MaticError(
                                "Native mission changed before recovery STOP"
                            )

                        def note_stop_transmitted() -> None:
                            nonlocal stop_may_have_been_sent
                            if stop_may_have_been_sent:
                                return
                            stop_may_have_been_sent = True
                            if on_recovery_stop_transmitted is not None:
                                on_recovery_stop_transmitted()

                        await self.async_send_user_command(
                            UserCommand.STOP, on_transmitted=note_stop_transmitted
                        )
                        stop_fence_prepared = False
                    except Exception, asyncio.CancelledError:
                        if stop_fence_prepared and not stop_may_have_been_sent:
                            try:
                                await rollback_stop()
                            except Exception, asyncio.CancelledError:
                                _LOGGER.warning(
                                    "Mixed coverage STOP fence rollback failed"
                                )
                        raise
            except Exception:
                _LOGGER.warning(
                    "Mixed coverage recovery could not confirm safe ownership"
                )
            raise

    async def _async_wait_for_mixed_coverage_readback(
        self,
        expected_goals: Counter[tuple[str, int, int, int, int]],
        *,
        require_current: Callable[[], None],
        expected_identity: bytes,
        command_payload: bytes | None = None,
        floor_plan: FloorPlan | None = None,
        expected_session_id: str | None = None,
    ) -> CoverageReceipt | None:
        """Require the acknowledged update to appear intact in the live plan."""
        timeout = asyncio.timeout(_MIXED_COVERAGE_READBACK_TIMEOUT)
        actual_goals: Counter[tuple[str, int, int, int, int]] | None = None
        malformed = False
        stage = "coverage_plan"
        receipt: CoverageReceipt | None = None

        def note_stage(value: str) -> None:
            nonlocal stage
            stage = value

        def capture_plan(plan: bytes, deep: bool) -> None:
            nonlocal receipt
            if (
                command_payload is not None
                and floor_plan is not None
                and expected_session_id is not None
            ):
                receipt = make_coverage_receipt(
                    command_payload,
                    plan,
                    floor_plan,
                    expected_session_id,
                    deep_mop_enabled=deep,
                )

        try:
            async with timeout:
                while True:
                    require_current()
                    stage = "coverage_plan"
                    try:
                        (
                            actual_goals,
                            matched,
                        ) = await self._async_read_coverage_readback(
                            expected_goals,
                            capture_plan=capture_plan,
                            note_stage=note_stage,
                        )
                        malformed = False
                    except DecodeError:
                        actual_goals = Counter()
                        malformed = True
                        matched = False
                    stage = "session_identity"
                    if (
                        await self._reads.async_get_cleaning_session_identity()
                        != expected_identity
                    ):
                        raise MaticError(
                            "Native mission changed during coverage readback"
                        )
                    if matched:
                        return (
                            receipt
                            if receipt is not None
                            and native_session_hash(expected_identity, active=True)
                            == receipt.session_hash
                            else None
                        )
                    stage = "poll_interval"
                    await asyncio.sleep(_MIXED_COVERAGE_READBACK_INTERVAL)
        except TimeoutError as err:
            if not timeout.expired():
                raise
            _log_mixed_readback_timeout(
                expected_goals, actual_goals, stage=stage, malformed=malformed
            )
            raise MaticError("Mixed coverage readback verification timed out") from err

    async def _async_read_coverage_readback(
        self,
        expected_goals: Counter[tuple[str, int, int, int, int]],
        *,
        capture_plan: Callable[[bytes, bool], None] | None = None,
        note_stage: Callable[[str], None] | None = None,
    ) -> tuple[Counter[tuple[str, int, int, int, int]], bool]:
        """Qualify an override with current native state around a fresh plan.

        This is observed current-state consistency, not proof that the global
        override was enabled at dispatch or an atomic property snapshot.
        The caller must still verify native session and ownership guards.
        """

        async def read(name: str, stage: str) -> bytes:
            if note_stage is not None:
                note_stage(stage)
            return await self._collections.async_get_property(name)

        plan = await read("coverage_plan", "coverage_plan")
        actual_goals = Counter(coverage_plan_goal_signatures(plan))
        if coverage_readback_matches(expected_goals, actual_goals):
            if capture_plan is not None:
                capture_plan(plan, False)
            return actual_goals, True
        if not coverage_readback_matches(
            expected_goals, actual_goals, deep_mop_enabled=True
        ):
            return actual_goals, False
        if (
            decode_deep_mop_state(
                await read("deep_mop_override_setting_state", "deep_mop_state_before")
            )
            is not True
        ):
            return actual_goals, False
        plan = await read("coverage_plan", "coverage_plan_confirm")
        actual_goals = Counter(coverage_plan_goal_signatures(plan))
        if coverage_readback_matches(expected_goals, actual_goals):
            if capture_plan is not None:
                capture_plan(plan, False)
            return actual_goals, True
        if not coverage_readback_matches(
            expected_goals, actual_goals, deep_mop_enabled=True
        ):
            return actual_goals, False
        deep_mop_enabled = (
            decode_deep_mop_state(
                await read("deep_mop_override_setting_state", "deep_mop_state_after")
            )
            is True
        )
        matched = deep_mop_enabled and coverage_readback_matches(
            expected_goals, actual_goals, deep_mop_enabled=True
        )
        if matched and capture_plan is not None:
            capture_plan(plan, True)
        return actual_goals, matched

    async def _async_wait_for_coverage_readback(
        self,
        expected_goals: Counter[tuple[str, int, int, int, int]],
        floor_plan: FloorPlan,
        *,
        pre_dispatch_identity: bytes,
        expected_session_id: str,
        command_payload: bytes | None = None,
    ) -> CoverageReceipt | None:
        """Require the generated session and observe matching active-goal values.

        Exact goal UUID echoes additionally produce a dispatch receipt. This
        receipt alone cannot grant cadence credit: completion must match this
        session and the same retained vacuum goals must be observed again.
        """
        deadline = monotonic() + _COVERAGE_START_READBACK_TIMEOUT
        observed_identity: bytes | None = None
        receipt: CoverageReceipt | None = None

        def capture_plan(plan: bytes, deep: bool) -> None:
            nonlocal receipt
            if command_payload is not None:
                receipt = make_coverage_receipt(
                    command_payload,
                    plan,
                    floor_plan,
                    expected_session_id,
                    deep_mop_enabled=deep,
                )

        async with asyncio.timeout(_COVERAGE_START_READBACK_TIMEOUT):
            while True:
                identity = await self._reads.async_get_cleaning_session_identity()
                if identity is None:
                    raise MaticError("Native task identity became unavailable")
                if identity and identity != pre_dispatch_identity:
                    try:
                        observed_session_id = uuid_string(identity)
                    except DecodeError as err:
                        raise MaticError(
                            "Native task identity cannot be correlated to coverage"
                        ) from err
                    if observed_session_id != expected_session_id:
                        raise MaticError(
                            "Native mission does not match dispatched coverage"
                        )
                    if observed_identity is None:
                        observed_identity = identity
                    elif identity != observed_identity:
                        raise MaticError(
                            "Native mission changed during coverage readback"
                        )
                    active = await self._reads.async_get_active_cleaning_session_state()
                    if active is True:
                        try:
                            _, matched = await self._async_read_coverage_readback(
                                expected_goals, capture_plan=capture_plan
                            )
                        except DecodeError:
                            matched = False
                        if matched:
                            if (
                                await self._reads.async_get_cleaning_session_identity()
                                != identity
                            ):
                                raise MaticError(
                                    "Native mission changed during coverage readback"
                                )
                            active = await (
                                self._reads.async_get_active_cleaning_session_state()
                            )
                            if active is not True:
                                raise MaticError(
                                    "Native mission became inactive during "
                                    "coverage readback"
                                )
                            latest_floor = await self._reads.async_get_floor_plan()
                            if _floor_command_identity(
                                latest_floor
                            ) != _floor_command_identity(floor_plan):
                                raise MaticError(
                                    "Room map changed during coverage readback"
                                )
                            # Recheck both live guards after the floor await;
                            # leave identity last so ownership is freshest at
                            # the point we accept readback.
                            active = await (
                                self._reads.async_get_active_cleaning_session_state()
                            )
                            if active is not True:
                                raise MaticError(
                                    "Native mission became inactive during "
                                    "coverage readback"
                                )
                            if (
                                await self._reads.async_get_cleaning_session_identity()
                                != identity
                            ):
                                raise MaticError(
                                    "Native mission changed during coverage readback"
                                )
                            return (
                                receipt
                                if receipt is not None
                                and native_session_hash(identity, active=True)
                                == receipt.session_hash
                                else None
                            )
                if monotonic() >= deadline:
                    raise MaticError(
                        "Robot did not report requested settings with the "
                        "dispatched active session"
                    )
                await asyncio.sleep(_MIXED_COVERAGE_READBACK_INTERVAL)

    async def async_confirm_coverage_receipt(
        self, receipt: CoverageReceipt, completion_session_hash: str
    ) -> bool:
        """Re-observe exact vacuum goals after that native session completed.

        A cleared inactive session is allowed only because the unique retained
        goal IDs and matched history key independently bind the same dispatch.
        Unavailable or changed evidence withholds cadence credit; it does not
        invalidate otherwise verified native cleaning completion.
        """
        if receipt.session_hash != completion_session_hash:
            return False
        try:
            async with asyncio.timeout(_MIXED_COVERAGE_READBACK_TIMEOUT):
                identity = await self._reads.async_get_cleaning_session_identity()
                if identity is None or (
                    identity
                    and native_session_hash(identity, active=True)
                    != receipt.session_hash
                ):
                    return False
                if (
                    await self._reads.async_get_active_cleaning_session_state()
                    is not False
                ):
                    return False
                if (
                    coverage_floor_hash(await self._reads.async_get_floor_plan())
                    != receipt.floor_hash
                ):
                    return False
                plan = await self._collections.async_get_property("coverage_plan")
                history_fingerprint = None
                if not receipt_matches_plan(receipt, plan):
                    if not coverage_plan_lacks_active_goals(plan):
                        return False
                    history_fingerprint = (
                        await self._async_coverage_history_fingerprint(receipt)
                    )
                    if history_fingerprint is None:
                        return False
                if (
                    coverage_floor_hash(await self._reads.async_get_floor_plan())
                    != receipt.floor_hash
                ):
                    return False
                if (
                    await self._reads.async_get_active_cleaning_session_state()
                    is not False
                ):
                    return False
                if await self._reads.async_get_cleaning_session_identity() != identity:
                    return False
                # A second fresh sample catches same-session edits during the
                # floor/activity checks. The protocol has no atomic generation
                # marker, so this establishes observed consistency only.
                final_plan = await self._collections.async_get_property("coverage_plan")
                if history_fingerprint is None:
                    return receipt_matches_plan(receipt, final_plan)
                if not coverage_plan_lacks_active_goals(final_plan):
                    return False
                return history_fingerprint == (
                    await self._async_coverage_history_fingerprint(receipt)
                )
        except MaticError, DecodeError, TimeoutError:
            return False

    async def _async_coverage_history_fingerprint(
        self, receipt: CoverageReceipt
    ) -> str | None:
        """Bind one complete retained goal set to its unique native history key."""
        entries = await self._collections.async_get_tracked_collection_entries(
            "coverage_session_history", limit=64
        )
        matches = [
            entry
            for entry in entries
            if native_session_hash(entry.key) == receipt.session_hash
        ]
        if len(matches) != 1 or not receipt_matches_history(receipt, matches[0].value):
            return None
        return hashlib.sha256(matches[0].value).hexdigest()

    async def async_start_custom_coverage(
        self,
        floor_plan: FloorPlan,
        circles: list[tuple[float, float, float]],
        *,
        cleaning_mode: CleaningMode,
        coverage_setting: CoverageSetting,
        session_id: UUID | None = None,
        require_current: Callable[[], None] | None = None,
        expected_idle_revision: str | None = None,
    ) -> None:
        """Start an official drawn-circle custom-area coverage command.

        A managed plan passes the session ID it will recognise as its own
        mission; that start also requires an idle native session first, as a
        tracked room start does.
        """
        payload = encode_custom_coverage_command(
            mission_id=floor_plan.mission_id,
            circles=circles,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
            session_id=session_id,
        )
        if session_id is not None:
            await self._async_require_idle_native_session()
        await self._async_check_idle_session_revision(expected_idle_revision)
        if require_current is not None:
            require_current()
        await self._connection._async_send_user_payload(
            payload, command_name="START_CUSTOM_COVERAGE"
        )

    async def async_set_binary_setting(self, setting: str, enabled: bool) -> None:
        """Set a live-verified reversible binary preference."""
        try:
            channel = _BINARY_SETTING_CHANNELS[setting]
            state_property = _BINARY_SETTING_STATE_PROPERTIES[setting]
        except KeyError as err:
            raise ValueError(f"Unsupported binary setting: {setting}") from err
        await self._connection._async_send_channel_payload(
            channel,
            bytes((0x08, int(enabled))),
        )
        await self._async_confirm_setting_readback(
            state_property, decode_binary_state, enabled
        )

    async def async_set_deep_mop(self, enabled: bool) -> None:
        """Set the verified double-pass mopping override."""
        await self._connection._async_send_channel_payload(
            "deep_mop_override_setting_command",
            b"\x12\x00" if enabled else b"\x0a\x00",
        )
        await self._async_confirm_setting_readback(
            "deep_mop_override_setting_state", decode_deep_mop_state, enabled
        )

    async def async_set_water_flow(self, factor: float) -> None:
        """Set the verified 0.5x to 2.0x water-flow factor."""
        if not math.isfinite(factor) or not 0.5 <= factor <= 2.0:
            raise ValueError("Water flow must be between 0.5 and 2.0")
        rounded = round(factor, 1)
        if not math.isclose(factor, rounded, abs_tol=1e-6):
            raise ValueError("Water flow must use 0.1 increments")
        await self._connection._async_send_channel_payload(
            "water_flow_override_command",
            b"\x0a\x05\x0d" + struct.pack("<f", rounded),
        )
        await self._async_confirm_setting_readback(
            "water_flow_override_state", decode_water_flow_factor, rounded
        )

    async def async_scan_wifi_signal(self) -> int | None:
        """Ask the robot for one Wi-Fi scan and return its link signal in dBm.

        The robot replies once the scan is done. The scan reply is unread;
        the result is taken from ``wifi_status`` once its scan block differs
        from the one read before the request, or after a short settle when an
        identical scan left it unchanged. ``None`` means no scan block
        appeared in time or the connected network was not listed.
        """
        baseline = wifi_scan_block(
            await self._collections.async_get_property("wifi_status")
        )
        await self._connection._async_send_channel_payload("wifi_scan_command", b"")
        reads = 0
        try:
            async with asyncio.timeout(_WIFI_SCAN_RESULT_TIMEOUT_SECONDS):
                while True:
                    await asyncio.sleep(_WIFI_SCAN_RESULT_INTERVAL_SECONDS)
                    payload = await self._collections.async_get_property("wifi_status")
                    scan = wifi_scan_block(payload)
                    reads += 1
                    if scan is not None and (
                        scan != baseline or reads >= _WIFI_SCAN_SETTLE_READS
                    ):
                        return decode_wifi_status(payload)[2]
        except TimeoutError:
            return None

    async def _async_confirm_setting_readback(
        self,
        property_name: str,
        decode: Callable[[object], bool | float | None],
        expected: bool | float,
    ) -> None:
        """Wait for one acknowledged setting write to appear in fresh state."""
        reconnect_attempted = False
        try:
            async with asyncio.timeout(_SETTING_READBACK_TIMEOUT_SECONDS):
                while True:
                    await self._connection.async_connect()
                    failed_channel = self._connection._channel
                    try:
                        observed = decode(
                            await self._collections.async_get_property(property_name)
                        )
                    except CannotConnectError:
                        if reconnect_attempted:
                            raise
                        _LOGGER.debug(
                            "Retrying Hermes %s setting read on a fresh pinned channel",
                            property_name,
                        )
                        await self._connection._async_reconnect_after_read_failure(
                            failed_channel
                        )
                        reconnect_attempted = True
                        observed = None
                    if observed is not None and observed == expected:
                        return
                    await asyncio.sleep(_SETTING_READBACK_INTERVAL_SECONDS)
        except TimeoutError as err:
            raise CannotConnectError(
                "The robot did not confirm the requested setting"
            ) from err
