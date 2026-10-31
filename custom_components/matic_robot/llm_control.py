"""Administrator-only robot control tools and their admission checks."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any, cast, override

import probatio
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import llm, translation
from homeassistant.util.json import JsonObjectType

from .client.commands import CleaningMode
from .const import DOMAIN, MAX_ROOM_SEQUENCE_SIZE
from .llm_common import _ROBOT_FIELD, _error, _MaticTool, _resolve_plan_id
from .plan_model import resolve_room_reference
from .slam_scene import catalog_entry_projection

_LOGGER = logging.getLogger(__name__)

# Wait for an early refusal while an action continues through the cleaning run.
RUN_START_WAIT_SECONDS = 5.0


class MaticRunPlanTool(_MaticTool):
    """Run a saved plan exactly as Matic Map's Run plan does."""

    name = "MaticRunPlan"
    title = "Run plan"
    description = (
        "Starts a saved plan, by name or the default plan, when Matic Map would "
        "allow it, and returns whether the cleaning run started. When the robot "
        "can't start, returns the reason to tell the user."
    )
    annotations = llm.ToolAnnotations(destructive=False, open_world=False)
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        if reason := robot.start_block_reason():
            return await _async_refusal(hass, llm_context, "common", reason)
        manager = robot.entry.runtime_data.cleaning_plans
        plan_id = _resolve_plan_id(manager, robot.serial_number, args.get("plan"))
        try:
            plan = manager.catalog.plan(robot.serial_number, plan_id)
        except KeyError:
            # No plan was named and the robot has no saved plan to default to.
            return await _async_refusal(
                hass, llm_context, "exceptions", "unknown_plan", {"plan": ""}
            )
        if not plan.get("enabled", True):
            return await _async_refusal(
                hass, llm_context, "common", "v4_reason_run_plan_paused"
            )
        target = {ATTR_ENTITY_ID: robot.entity_id, "plan": plan["id"]}
        try:
            preview = await hass.services.async_call(
                DOMAIN,
                "preview_plan",
                target,
                blocking=True,
                context=llm_context.context,
                return_response=True,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        return await _async_start_run(
            hass,
            llm_context,
            "run_selected_plan",
            {**target, "preview_token": cast(dict[str, Any], preview)["preview_token"]},
            {"plan": str(plan.get("name", plan["id"]))},
        )


class MaticCleanRoomsTool(_MaticTool):
    """Clean named rooms exactly as Matic Map's Clean rooms does."""

    name = "MaticCleanRooms"
    title = "Clean rooms"
    description = (
        "Starts cleaning the named rooms in order with one cleaning mode, when "
        "Matic Map would allow it, and returns whether the cleaning run started. "
        "Each room keeps its saved schedule. When the robot can't start, returns "
        "the reason to tell the user."
    )
    annotations = llm.ToolAnnotations(destructive=False, open_world=False)
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Required("rooms"): probatio.All(
                cv.ensure_list,
                [probatio.All(cv.string, probatio.Length(min=1, max=128))],
                probatio.Length(min=1, max=MAX_ROOM_SEQUENCE_SIZE),
            ),
            probatio.Optional(
                "cleaning_mode", default=CleaningMode.VACUUM.value
            ): probatio.In([mode.value for mode in CleaningMode]),
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        if reason := robot.start_block_reason():
            return await _async_refusal(hass, llm_context, "common", reason)
        sequence = {
            ATTR_ENTITY_ID: robot.entity_id,
            "rooms": [
                {"room": room, "cleaning_mode": args["cleaning_mode"]}
                for room in args["rooms"]
            ],
            "use_room_schedule": True,
            "override_room_schedule": False,
            "return_to_base": True,
        }
        try:
            preview = cast(
                dict[str, Any],
                await hass.services.async_call(
                    DOMAIN,
                    "preview_room_sequence",
                    sequence,
                    blocking=True,
                    context=llm_context.context,
                    return_response=True,
                ),
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        if preview["blocker"] or not preview["rooms"]:
            return await _async_refusal(
                hass, llm_context, "common", "v4_reason_room_preview_blocked"
            )
        return await _async_start_run(
            hass,
            llm_context,
            "clean_room_sequence",
            {**sequence, "preview_token": preview["preview_token"]},
            {"rooms": [str(room["name"]) for room in preview["rooms"]]},
        )


class MaticStopCleaningTool(_MaticTool):
    """Stop cleaning exactly as Matic Map's Stop does."""

    name = "MaticStopCleaning"
    title = "Stop cleaning"
    description = (
        "Stops cleaning and sends the robot back to its dock, as Matic Map's Stop "
        "does, and returns whether Stop was sent. When Stop can't be sent, returns "
        "the reason to tell the user."
    )
    annotations = llm.ToolAnnotations(
        destructive=False, idempotent=True, open_world=False
    )
    parameters = llm.Tool.parameters.extend(_ROBOT_FIELD)

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        if not robot.connected:
            return await _async_refusal(
                hass, llm_context, "exceptions", "llm_robot_unavailable"
            )
        if robot.projection["stop_settle_pending"]:
            return await _async_refusal(hass, llm_context, "common", "v4_reason_stop")
        if not robot.has_stoppable_work:
            return await _async_refusal(
                hass, llm_context, "exceptions", "llm_nothing_to_stop"
            )
        try:
            await hass.services.async_call(
                DOMAIN,
                "stop_intelligent_cleaning",
                {ATTR_ENTITY_ID: robot.entity_id, "include_unmanaged": True},
                blocking=True,
                context=llm_context.context,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        return llm.ToolResult(data={"stop_sent": True})


class MaticResetScheduleTool(_MaticTool):
    """Reset schedule progress exactly as Matic Map's plan editor does."""

    name = "MaticResetSchedule"
    title = "Reset schedule progress"
    description = (
        "Resets mopping or vacuum rotation progress for one room or every room of "
        "a saved plan, as Matic Map does, and returns what was reset. Cleaning "
        "history is kept. When the reset isn't allowed, returns the reason to tell "
        "the user."
    )
    annotations = llm.ToolAnnotations(idempotent=True, open_world=False)
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            probatio.Optional("room"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            probatio.Required("schedule"): probatio.In(("mop", "coverage")),
            probatio.Optional("scope", default="room"): probatio.In(("room", "plan")),
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        if args["scope"] == "room" and "room" not in args:
            raise _error("llm_room_required")
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        if reason := robot.edit_block_reason():
            return await _async_refusal(hass, llm_context, "common", reason)
        manager = robot.entry.runtime_data.cleaning_plans
        plan_id = _resolve_plan_id(manager, robot.serial_number, args.get("plan"))
        try:
            plan = manager.catalog.plan(robot.serial_number, plan_id)
        except KeyError:
            # No plan was named and the robot has no saved plan to default to.
            return await _async_refusal(
                hass, llm_context, "exceptions", "unknown_plan", {"plan": ""}
            )
        data: dict[str, Any] = {
            ATTR_ENTITY_ID: robot.entity_id,
            "plan": plan["id"],
            "modes": [args["schedule"]],
        }
        room_name: str | None = None
        if args["scope"] == "room":
            floor_plan = robot.entry.runtime_data.coordinator.data.floor_plan
            room_map = {room.id: room.name for room in floor_plan.rooms}
            try:
                data["room_id"], room_name = resolve_room_reference(
                    args["room"], room_map
                )
            except ValueError as err:
                raise _error("llm_room_unknown", room=args["room"]) from err
        try:
            await hass.services.async_call(
                DOMAIN,
                "reset_room_cadence",
                data,
                blocking=True,
                context=llm_context.context,
                return_response=True,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        return llm.ToolResult(
            data={
                "reset": True,
                "plan": str(plan.get("name", plan["id"])),
                "room": room_name,
                "schedule": args["schedule"],
            }
        )


class MaticGoToRoomTool(_MaticTool):
    """Send the robot to a room with the Go to room action."""

    name = "MaticGoToRoom"
    title = "Go to room"
    description = (
        "Sends the robot to one named room without cleaning it and returns whether "
        "the command was sent. When the robot can't go, returns the reason to tell "
        "the user."
    )
    annotations = llm.ToolAnnotations(destructive=False, open_world=False)
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Required("room"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        if refusal := await _async_navigation_refusal(hass, llm_context, robot):
            return refusal
        try:
            await hass.services.async_call(
                DOMAIN,
                "go_to_room",
                {ATTR_ENTITY_ID: robot.entity_id, "room": args["room"]},
                blocking=True,
                context=llm_context.context,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        return llm.ToolResult(data={"sent": True, "room": args["room"]})


class MaticSendToSinkTool(_MaticTool):
    """Send the robot to its saved sink location for a water refill."""

    name = "MaticSendToSink"
    title = "Send to sink"
    description = (
        "Sends the robot to the sink location saved in the Matic app for this "
        "floor, where it waits up to 15 minutes for a water refill, and returns "
        "whether the command was sent. When the robot can't go, returns the reason "
        "to tell the user."
    )
    annotations = llm.ToolAnnotations(destructive=False, open_world=False)
    parameters = llm.Tool.parameters.extend(_ROBOT_FIELD)

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        if refusal := await _async_navigation_refusal(hass, llm_context, robot):
            return refusal
        try:
            await hass.services.async_call(
                VACUUM_DOMAIN,
                "send_command",
                {ATTR_ENTITY_ID: robot.entity_id, "command": "sink_summon"},
                blocking=True,
                context=llm_context.context,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        return llm.ToolResult(data={"sent": True})


async def _async_navigation_refusal(
    hass: HomeAssistant, llm_context: llm.LLMContext, robot: _PanelRobot
) -> llm.ToolResult | None:
    """Refuse navigation the robot's action would refuse or could not place."""
    if not robot.connected:
        return await _async_refusal(
            hass, llm_context, "exceptions", "llm_robot_unavailable"
        )
    if robot.projection["stop_settle_pending"]:
        return await _async_refusal(
            hass, llm_context, "common", "v4_reason_stop_settle_pending"
        )
    if not robot.can_edit:
        return await _async_refusal(
            hass, llm_context, "common", "v4_reason_clean_rooms_verification"
        )
    return None


class _PanelRobot:
    """The robot facts Matic Map's action strip decides from (`state.ts`)."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry[Any]) -> None:
        self.entry = entry
        self.serial_number = str(entry.runtime_data.coordinator.data.info.serial_number)
        entity_id = er.async_get(hass).async_get_entity_id(
            VACUUM_DOMAIN, DOMAIN, f"{self.serial_number}_vacuum"
        )
        if entity_id is None:
            raise _error("llm_robot_unavailable")
        self.entity_id = entity_id
        state = hass.states.get(entity_id)
        # `activityForVacuum` and `robotConnected` in `hass-adapter.ts`.
        self.activity = state.state if state is not None else STATE_UNAVAILABLE
        if (
            state is not None
            and state.attributes.get("recharge_and_resume") is True
            and state.attributes.get("charging") is True
        ):
            self.activity = "recharging"
        self.connected = self.activity not in (STATE_UNAVAILABLE, STATE_UNKNOWN)
        self.projection = catalog_entry_projection(entry.entry_id, entry.runtime_data)

    @property
    def can_edit(self) -> bool:
        """Mirror `canEditCoordinates`: a connected robot on a verified map."""
        projection = self.projection
        return bool(
            self.connected
            and projection["map_floor_coherent"]
            and projection["map_session_verified"]
            and projection["map_complete"]
            and not projection["map_truncated"]
            and projection["map_health"] not in ("problem", "limited")
        )

    @property
    def has_stoppable_work(self) -> bool:
        """Mirror `hasStoppableWork`."""
        projection = self.projection
        return bool(
            self.activity in ("cleaning", "paused", "returning", "recharging")
            or projection["runner_locked"]
            or projection["active_plan"]
            or projection["native_session_active"] is True
        )

    def edit_block_reason(self) -> str | None:
        """Return the strip reason that blocks a plan edit, if any."""
        if not self.can_edit:
            return "v4_reason_clean_rooms_verification"
        if self.activity not in ("idle", "docked"):
            return "v4_reason_robot_operation_waiting"
        return None

    def start_block_reason(self) -> str | None:
        """Mirror `canStartMotion` and its `motionBlockReason`."""
        projection = self.projection
        if not self.can_edit:
            return "v4_reason_clean_rooms_verification"
        if projection["stop_settle_pending"]:
            return "v4_reason_stop_settle_pending"
        if (
            projection["runner_locked"]
            or projection["active_plan"]
            or projection["native_reconciliation_pending"]
            or projection["native_session_active"] is True
            or self.activity not in ("idle", "docked")
        ):
            return "v4_reason_robot_operation_waiting"
        return None


async def _async_start_run(
    hass: HomeAssistant,
    llm_context: llm.LLMContext,
    service: str,
    data: dict[str, Any],
    started: JsonObjectType,
) -> llm.ToolResult:
    """Start a cleaning run on the panel's action and report early refusals."""
    task = hass.async_create_background_task(
        hass.services.async_call(
            DOMAIN, service, data, blocking=True, context=llm_context.context
        ),
        f"{DOMAIN} assistant {service}",
    )
    done, _pending = await asyncio.wait({task}, timeout=RUN_START_WAIT_SECONDS)
    if not done:
        task.add_done_callback(_log_run_end)
        return llm.ToolResult(data={"started": True, **started})
    if isinstance(err := task.exception(), HomeAssistantError):
        return await _async_service_refusal(hass, llm_context, err)
    if err is not None:
        raise err
    return llm.ToolResult(data={"started": True, "finished": True, **started})


@callback
def _log_run_end(task: asyncio.Task[Any]) -> None:
    """Retrieve the outcome of a run the assistant no longer waits for."""
    if not task.cancelled() and (err := task.exception()) is not None:
        _LOGGER.debug("Cleaning run started by an assistant ended: %s", err)


async def _async_service_refusal(
    hass: HomeAssistant, llm_context: llm.LLMContext, err: HomeAssistantError
) -> llm.ToolResult:
    """Relay an action's translated refusal, never raw exception text."""
    if err.translation_domain == DOMAIN and err.translation_key:
        return await _async_refusal(
            hass,
            llm_context,
            "exceptions",
            err.translation_key,
            err.translation_placeholders,
        )
    return await _async_refusal(hass, llm_context, "exceptions", "robot_command_failed")


async def _async_refusal(
    hass: HomeAssistant,
    llm_context: llm.LLMContext,
    category: str,
    key: str,
    placeholders: Mapping[str, str] | None = None,
) -> llm.ToolResult:
    """Return the strip's or action's reason in the conversation's language."""
    language = llm_context.language
    if language is None or language == "*":
        language = hass.config.language
    translations = await translation.async_get_translations(
        hass, language, category, [DOMAIN]
    )
    suffix = ".message" if category == "exceptions" else ""
    template = translations[f"component.{DOMAIN}.{category}.{key}{suffix}"]
    reason = template.format(**(placeholders or {}))
    return llm.ToolResult(data={"done": False, "reason": reason}, error=True)
