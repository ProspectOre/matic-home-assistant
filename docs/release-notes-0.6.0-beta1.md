# Matic 0.6 beta 1

Matic 0.6 brings more of the Matic app into Home Assistant and lets the two
work side by side. Send the robot to the sink or to a room, see the robot's own
schedules on a calendar, and keep using the app whenever you like.

This is a beta from the `release/0.6` branch. Install it only if you're happy
to try new features before 0.6.0.

## Highlights

- **Sink refill.** Send the robot to its saved sink location to refill the
  water tank, and it waits there while you fill it.
- **Go to room.** Send the robot to any room without cleaning it.
- **Robot schedules on a calendar.** Weekly schedules set in the Matic app
  appear as a read-only Home Assistant calendar.

## Sink refill

- **Send to sink.** `vacuum.send_command` with `command: sink_summon` sends the
  robot to the sink location saved in the Matic app and waits up to 15 minutes
  for the refill.
- **Works mid-clean.** Sent during a clean, the robot keeps its task and the
  plan driving it, then carries on after the refill.
- **Assistant tool.** Assist and MCP can send the robot to the sink.

## Go to room

- **Any room, by name or ID.** The **Go to room** action
  (`matic_robot.go_to_room`) and the `go_to_room` command send the robot to one
  room without marking it cleaned.
- **From Matic Map.** Pick one room and press **Go to room**.
- **Assistant tool.** Assist and MCP can send the robot to a room.

## Robot schedules

- **Calendar.** `calendar.matic_native_schedules` shows each enabled weekly
  schedule from the Matic app, with its rooms and cleaning mode.
- **Private by default.** Schedule details stay out of Recorder.

## Before you update

- Matic 0.6 needs the same robot firmware as 0.5 and keeps your plans, room
  schedules and map history.
- Unsaved room runs started from Matic Map are now called **One-time room
  clean**, including the last run recorded by 0.5.
- Rolling back to 0.5.0 keeps working: 0.6 doesn't change the stored data
  format.

See [Actions](actions.md), [Entities](entities.md) and
[Assistant tools](assistant-tools.md) for details.
