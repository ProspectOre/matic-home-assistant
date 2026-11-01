# Native schedule diagnostics

**Scheduled cleanings** reads the schedule records returned by the robot. In
0.5.1, weekdays use Monday through Sunday and room lists follow the room targets
reported by firmware v181.10. The sensor does not change schedules in the Matic app.

[Issue #384](https://github.com/ProspectOre/matic-home-assistant/issues/384)
also reports a missing second schedule and an unknown `enabled` value. The
weekday and room fixes do not resolve those two discrepancies. An unknown
on/off value is kept unknown rather than inferred from past cleaning runs.

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
If investigating the on/off field, compare inspections before and after changing
one schedule in the app, then restore the original setting. A changed checksum
alone does not establish a field's meaning. No schedule-setting action is
available through this diagnostic.

See [advanced actions](actions.md#advanced-actions) for the inspection service
and [privacy](privacy.md) for diagnostic data handling.
