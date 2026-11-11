# Native schedule diagnostics

**Robot schedules** reads the schedule records returned by the robot. In
0.5.1, the reader acknowledges each record so the stream can advance. Weekdays
use Monday through Sunday; room lists follow both ordered and unordered goals.
The calendar does not change schedules in the Matic app.

[Issue #384](https://github.com/ProspectOre/matic-home-assistant/issues/384)
identified incorrect weekdays, missing records, empty room lists and unknown
enabled state. The [protocol evidence](native-schedule-protocol.md) establishes
the state and ordering fields and the acknowledged read path. Suggested,
conflicting or unknown state markers remain unknown. Missing or mixed goal
lists also leave ordering unknown; it is never inferred from enabled state.
Affected-install confirmation remains open.

To investigate missing records, run **Advanced: Inspect robot data** from
Home Assistant's developer actions with the robot connected:

```yaml
action: matic_robot.inspect_hermes_endpoint
target:
  entity_id: vacuum.matic
data:
  endpoint: schedule_events
  limit: 256
```

Replace the example entity with your vacuum. The response reports the entry
count and each entry's sizes, checksums and `wire_shape`: field numbers and
wire types, including known nested schedule containers. It does not return
schedule names, times, room names, room identifiers or raw contents. Inspection
is bounded. If nested inspection reaches its limit, outer field markers are
retained with `wire_shape_root_only: true`. A null shape means even the bounded
outer structure could not be inspected.

Compare the entry count with the app's schedule count. Record whether the app
shows each schedule enabled, but keep names, times and home details private.
No schedule-setting action is available through this diagnostic. Existing
schedules can be inspected without changing their enabled state or contents.

See [advanced actions](actions.md#advanced-actions) for the inspection service
and [privacy](privacy.md) for diagnostic data handling.
