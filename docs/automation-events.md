# Automation events

[Automations](automation.md) · [Actions](actions.md)

Each event's type is `matic_robot_` plus the name in the second column.

| Event | Type | Fields |
| --- | --- | --- |
| Plan started | `plan_started` | `entity_id`, `plan_id`, `run_id`, `trigger`, `provenance`, `service`, `started_at`, `room_count` |
| Room started | `room_started` | `entity_id`, `plan_id`, `run_id`, `room_id`, `room`, `cleaning_mode`, `coverage_setting`, `provenance` |
| Room finished | `room_completed` | room fields, `reason_code` |
| Room skipped | `room_skipped` | room fields, `reason_code`, sometimes `cause` |
| Room failed | `room_failed` | room fields, `reason_code`, `cause`, `error` |
| Room cancelled | `room_cancelled` | room fields, `reason_code`, `cause` |
| Room stopped early | `room_interrupted` | room fields, `reason_code`, `cause`, usually `error` |
| Room ended unconfirmed | `room_ended_unverified` | room fields, `reason_code`, `cause` |
| Room held | `room_held` | `entity_id`, `plan_id`, `run_id`, `room_id`, `room`, `provenance`, `reason_code` (`occupied`), `sensor` |
| Room confirmed late | `room_reconciled` | `entity_id`, `plan_id`, `run_id`, `room_id`, `room`, `reason_code`, `cause` |
| Plan area started | `area_started` | `entity_id`, `plan_id`, `run_id`, `area_id`, `area`, `cleaning_mode`, `coverage_setting`, `provenance` |
| Plan area finished | `area_finished` | area fields |
| Plan area failed | `area_failed` | area fields, `reason_code` |
| Plan finished | `plan_finished` | `entity_id`, `plan_id`, `run_id`, `outcome`, `reason_code`, `cause`, `provenance`, `terminal_activity`, times, room counts |
| Plan docked | `plan_docked` | `entity_id`, `plan_id`, `run_id`, `outcome`, `docked_at` |
| Cleaning finished | `cleaning_finished` | `device_id`, `entry_id`, `started_at`, `ended_at`, `duration_seconds`, `completed`, `rooms`, `completed_rooms`, `room_durations`, `stop_reason` |
| Firmware changed | `firmware_changed` | `device_id`, `entry_id`, `previous_version`, `firmware_version` |
| Firmware checked | `firmware_analyzed` | `entry_id`, `firmware_version`, `compatibility_status`, change counts |
| Firmware report updated | `firmware_report_updated` | `entry_id`, `report_id`, `revision` |
| Cues activity | `cues` | `device_id`, `entry_id`, `event_type`, `intent` |
| Robot activity recorded | `activity_observed` | `entry_id`, `kind`, `source`, `run_id`, `command`, `outcome`, `activity` |

`stop_reason` is the robot's own record of how a clean ended: `finished` when
it ended on its own, `stopped` when someone pressed Stop (confirmed for the
Matic app), `unknown` for any other reason the robot records, and empty
when the robot recorded none. Who pressed Stop is not reported yet.

"Room fields" are those of Room started; "area fields" those of Plan area
started. A plan of Kitchen, a custom area and Hall, in Saved order, sends Plan
started, Room started and Room finished for Kitchen, Plan area started and
finished for the area, the room pair for Hall, then one Plan finished with `outcome: completed`.
Other outcomes: `stopped_docked`, `recharge_suspended`, `cancelled`, `failed`,
`unverified`. One-time room cleans from Matic Map or Clean room sequence send
room and plan events too, with a `plan_id` starting `__matic_manual_room_sequence__`.

## Run events in automations, the logbook and the dashboard

The run events are every event from Plan started to Cleaning finished in the
table above. Each one also:

- updates the robot's **Cleaning run** event entity
  (`event.matic_cleaning_run`). Its event type is the event's type and its
  attributes are the event's fields, less `entity_id`, `device_id` and
  `entry_id`. Like every Matic entity it is unavailable while the robot is
  unreachable; a run event in that time still reaches the bus, the device
  trigger and the logbook, but not an entity trigger.
- is a device trigger of the same type: on the robot's device page, select +
  on the Automations card. Room, area and plan triggers match the robot's
  vacuum entity; Cleaning finished matches the device.
- shows in the logbook against the robot, for example "Matic finished cleaning
  Kitchen".

To trigger on the entity, use Home Assistant's event entity trigger. Room
events can arrive milliseconds apart, so queue the automation's runs:

```yaml
mode: queued
triggers:
  - trigger: event.received
    target:
      entity_id: event.matic_cleaning_run
    options:
      event_type: [room_completed, room_failed]
```

Cleaning finished needs the robot's own history and is not replayed after a
restart. Use Room finished for plan room results; see
[cleaning results](native-cleaning-results.md) for partial and combined runs.

To investigate an event, download diagnostics
(Settings > Devices & services > Matic (Unofficial) > ⋮ on the robot's entry >
Download diagnostics) and follow [investigating interrupted cleaning](activity-diagnostics.md).
