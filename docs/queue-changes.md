# Changing a running clean

[Actions](actions.md) · [Automations and examples](automation.md)

While the robot is cleaning rooms, three actions change what it does next, as
the queue sheet in the Matic app does. Each takes the target vacuum and one
`room`, by name or room ID; a name shared by two rooms is refused.

| Action | `vacuum.send_command` command | What it does |
| --- | --- | --- |
| Skip room (`matic_robot.skip_room`) | `skip_room` | Drops a waiting room, or the room being cleaned, from this clean. |
| Clean room next (`matic_robot.clean_room_next`) | `clean_room_next` | Moves a waiting room to right after the room being cleaned. |
| Clean room again (`matic_robot.clean_room_again`) | `clean_room_again` | Gives the room new passes. A waiting room or the current one is redone in place; a finished room is added at the end. |

Clean room again keeps the room's modes and vacuum coverage unless you pass
`cleaning_mode` or `coverage_setting` (`coverage` in `params` for
`vacuum.send_command`). When the robot's plan no longer holds the room, for
example a room from an earlier mission of a plan run, pass both.

```yaml
actions:
  - action: matic_robot.skip_room
    target:
      entity_id: vacuum.matic
    data:
      room: Kitchen
```

The action returns once the robot's own plan shows the change, usually within
20 seconds, and fails if the robot doesn't confirm it within 45 seconds. Every
change fires `matic_robot_queue_changed` with `action`, `room_id`, `room` and,
during a plan run, its `run_id`.

## Matic Map

While the robot is cleaning a room, Matic Map's home view shows **Change this
clean**: pick a room (it starts on the room being cleaned) and choose Skip,
Clean next or Clean again. The buttons wait while the robot confirms, and the
notice under the heading says what changed or why the robot refused. Clean
again there always keeps the room's modes and coverage.

## Plan runs

A plan run keeps ownership of the clean. A room skipped during a plan run is
recorded as skipped: it gets no completion credit, fires
`matic_robot_room_skipped` with the run's `run_id` when the run settles, and
keeps its place in the plan's rotation, so the next run still treats it as
due. Run history shows it as **Skipped**.

Any queue change also means the robot's goals no longer match what the run
sent, so the run's rooms are credited as cleaned but not with their coverage
setting (for example, Heavy Duty).

## Limits

- The robot must be cleaning a room on the current map. While it is between
  rooms or in a space outside the map, try again once it is in a room.
- A clean that includes a custom area is refused; use the Matic app.
- A room the robot hasn't been asked to clean can't be skipped or moved. In a
  plan run with rooms split into several missions, only the rooms in the
  current mission can be changed.
- Skipping the only room left is refused; stop the clean instead.
- Skip and Clean room again match recordings of the Matic app's own changes on
  a live robot. Clean room next matches the app's encoder but has not yet been
  seen reordering rooms on a robot.
