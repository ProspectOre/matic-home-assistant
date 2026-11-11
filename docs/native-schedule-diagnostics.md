# Robot schedule diagnostics

[Troubleshooting](troubleshooting.md) · [Advanced actions](actions.md#advanced-actions) ·
[Privacy](privacy.md#diagnostics)

The **Robot schedules** calendar shows the schedules the robot reports. It is
read only: nothing here changes a schedule in the Matic app.

- Weekdays run Monday to Sunday.
- A schedule the app only suggests, or one whose enabled marker is missing or
  contradictory, shows its enabled state as unknown.
- Room order is unknown when the robot's two room lists are missing or mixed.
  It is never guessed from the enabled state.

[Protocol notes](protocol-notes.md#schedules-schedule_events) has the fields
behind these rules.

## Compare with the Matic app

When schedules are missing or look wrong, run **Advanced: Inspect robot data**
from Home Assistant's developer actions with the robot connected:

```yaml
action: matic_robot.inspect_hermes_endpoint
target:
  entity_id: vacuum.matic
data:
  endpoint: schedule_events
  limit: 256
```

Replace the example entity with your vacuum. The response gives the number of
entries and, for each, its sizes, checksums and `wire_shape`: field numbers and
wire types only. It returns no schedule names, times, room names, room IDs or
raw contents. When an entry is too deeply nested to inspect in full, it keeps
the outer fields and sets `wire_shape_root_only: true`; a null shape means not
even those could be read.

Compare the entry count with the number of schedules in the app, and note
whether the app shows each one enabled. Keep names, times and home details out
of anything you share. Inspecting never changes a schedule.
