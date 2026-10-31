# Robot command actions

[Action reference](actions.md) · [Cleaning guide](cleaning.md)

## Sink refill

`vacuum.send_command` with `command: sink_summon` sends the robot to the sink
location saved in the Matic app for the current floor. It waits there for up to
15 minutes for a water refill. Sent from the dock or while idle, it then docks.
During a clean, including a plan run, the robot keeps its task: Resume continues
the clean straight away, and otherwise it continues once the wait ends. A plan
docked between rooms holds no task, so a summon then ends the plan like any
other direct command. The floor must have a saved sink location.

```yaml
actions:
  - action: vacuum.send_command
    target:
      entity_id: vacuum.matic
    data:
      command: sink_summon
```

## Go to room

**Go to room** (`matic_robot.go_to_room`) sends the robot to one `room`, by name
or room ID, without cleaning it. A name shared by two rooms is refused; use the
room ID. The same `vacuum.send_command` command is `go_to_room` with
`params: {room: Kitchen}`. In Matic Map, pick one room and press **Go to room**.

Go to room follows the sink refill's rules: sent during a clean, the robot keeps
its task and the plan driving it, and from the dock or while idle it ends a plan
docked between rooms. It never marks a room as cleaned. Sent from the dock, the
robot reaches the room and waits there for 10 minutes before heading back on
its own; `stay_put` keeps it there.

```yaml
actions:
  - action: matic_robot.go_to_room
    target:
      entity_id: vacuum.matic
    data:
      room: Kitchen
```

## Stay put and emotes

`vacuum.send_command` with `command: stay_put` tells the robot to stay where it
is rather than return to the dock. The Matic app sends it when you cancel the
robot's own countdown to dock after a task; on a real robot it cancelled that
countdown and the robot stayed put. Home Assistant's Stop always docks,
so stay put waits until that return has settled; use Pause to keep the robot
where it is. `command: emote` with `params: {kind: snap}` takes
a photo with the robot's camera, which then shows in the Matic app. The kinds
`nod`, `shake` and `pirouette` are the app's other emotes. The robot accepts
all of them; whether those three visibly move it is not confirmed yet.

```yaml
actions:
  - action: vacuum.send_command
    target:
      entity_id: vacuum.matic
    data:
      command: emote
      params:
        kind: snap
```

## Repeat the last clean

`vacuum.send_command` with `command: redo_last_clean` cleans the robot's most
recent finished clean again, like **Clean again** in the Matic app's history.
It starts only while the robot is docked or idle and, like any direct clean,
ends a plan docked between rooms. Tried on a real robot, it started the same
rooms as the previous clean within 10 seconds.
