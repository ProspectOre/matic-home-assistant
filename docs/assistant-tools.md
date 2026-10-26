# Assistant and MCP tools

[Documentation](README.md) · [Entities](entities.md)


Two LLM APIs serve Assist conversation agents and Home Assistant's MCP server.
Only administrators get tools; anyone else gets no tools and a one-line prompt
to ask an administrator.

**Matic: Robot status (administrators only)** reads robot status, a plan's next
run, whether its saved areas are ready on the current map, robot-reported
history, recent events and command activity (`MaticGetOperations`,
`MaticGetPlan`, `MaticGetPlanReadiness`, `MaticGetNativeHistory`,
`MaticGetRecentEvents`, `MaticGetActivity`, `MaticGetFirmware`). Its write tools
use Matic Map's own actions and checks: `MaticRunPlan` (a plan name or the
default plan), `MaticCleanRooms` (room names and a cleaning mode),
`MaticStopCleaning` and `MaticResetSchedule` (mopping or vacuum rotation progress
for one room or a whole plan). When Matic Map would refuse, the tool returns the
same reason instead. Assist agents get these tools, prefixed `matic_robot__`,
when the robot is exposed to Assist.
Recent events keep room and final-state evidence separate from the
[command and raw-state observation trail](activity-diagnostics.md).
`MaticGetOperations` includes current-room active time, expected duration and
Estimated % from the same entity sample shown in Matic Map. Paused time stays
frozen; unknown estimates stay unknown. Even Estimated 100% does not prove a
room finished. The sample refreshes every five seconds; the tool never starts
another clock or sends a command to read it. Missing, disabled, unavailable or
unmatched timing stays unknown. Dust-bag observations are also available here.

These tools ship with the Home Assistant integration. After installing an
update and restarting Home Assistant, reconnect the MCP client if it retains
the previous tool descriptions. Existing API selections and permissions stay
the same.
`MaticGetPlanReadiness` reports only map and saved-area readiness for a
preview; the normal robot control checks still decide whether a cleaning run
can start.

**Matic: Firmware research (administrators only)** reads the
[firmware intelligence inbox](firmware-intelligence.md) (`MaticGetFirmware`) and
claims and completes research (`MaticClaimFirmwareInvestigation`,
`MaticCompleteFirmwareInvestigation`). It writes research records only, never a
robot command, and is reachable only from an MCP client that selects it.
