# Architecture

[Contributing](../CONTRIBUTING.md) · [Testing](testing.md) · [Working alongside the Matic app](coexistence.md)

Where each responsibility lives in the source, and what each part must not do.

## Ownership rules

One part owns each concern, and the others read its answer instead of working
out their own.

| Part | Owns | Must not |
| --- | --- | --- |
| Protocol client | The pinned connection and the vetted commands | Hold Home Assistant workflows or policy |
| Robot session | The client, the robot's live state and whether the robot is reachable | Let anything but the state watch write robot state |
| Heartbeat | The floor the robot reports and its matching floor plan | Treat a cached floor as current after a floor change |
| Map store | Which map data is admitted as live, and its size limits | Restore a floor's identity from old geometry |
| Cleaning policy | Rotation, room schedules, effective settings and their explanations | Send commands or decide that a room is done |
| Managed executor | Sending each leg, ownership, handoffs, stop settlement and restart recovery | Keep a second record of what completed |
| Completion accounting | Room results the robot confirmed, area missions the run owned, and counting each once | Take completion from the interface or from the robot's unnamed area summary |
| Services, HTTP views, assistant tools and the frontend | Authorized, bounded views of the above | Carry cleaning or map rules of their own |

A preview, the command that follows it and the explanation shown afterwards
all come from the same policy and accounting results.

## Integration and robot

Home Assistant owns setup, entity and service lifecycles. The integration keeps
robot traffic local, validates and pins the robot's identity, and cleans up its
resources on unload. The [Hermes client](../custom_components/matic_robot/client/api.py)
composes the pinned [connection](../custom_components/matic_robot/client/hermes_connection.py),
collection transport, decoded reads and validated commands. One
[supervisor](../custom_components/matic_robot/client/supervisor.py) task dials,
pins the certificate, completes the handshake, pings the open connection and
redials a lost one after a jittered, growing pause; nothing else opens, closes
or retries a connection. A failed request raises a transport, timeout,
protocol, unsupported-endpoint or authentication error, and only the loss of
the connection itself replaces it. Bounded telemetry decoders handle robot
state and native cleaning summaries.
[Discovery](../custom_components/matic_robot/config_flow_discovery.py) selects
a certificate-bound address; [vacuum catalogs](../custom_components/matic_robot/vacuum_catalog.py)
map Home Assistant areas to floor-scoped rooms.

Each config entry has one [robot session](../custom_components/matic_robot/session.py).
It reads identity and state once at setup; after that a `kabuki_state` watch,
reopened by the supervisor whenever it ends, is the only writer of its state
store, at most one snapshot a second. [Robot health](../custom_components/matic_robot/robot_health.py)
shows an error code or bag flag once two samples 30 seconds apart carry it. A
failed dial, or 10 seconds with no live state subscription, makes the robot
and every entity unavailable until the next snapshot; the keepalive ping ends
a silent connection. A `latest_pose` watch feeds the map trail and Matic Map.
The session raises the identity Repair, starts reauthentication when a dial or
subscription is refused, and closes on unload and when Home Assistant stops.

The session keeps one [store](../custom_components/matic_robot/stores.py) per
kind of robot data, each with one writer; entities, Matic Map and listeners
subscribe to the stores they read. Its [heartbeat](../custom_components/matic_robot/heartbeat.py)
writes what the robot does not push: the floor plan, telemetry, run progress
and cleaning history, every 5 minutes docked and every 30 seconds off the dock,
never while the robot is unreachable. Cached geometry alone cannot set a floor.

## Plans and completion

[CleaningPlanManager](../custom_components/matic_robot/plans.py) composes
these owners around one repository:

| Owner | Responsibility |
| --- | --- |
| [Repository](../custom_components/matic_robot/plan_repository.py) | Durable state and admitted metadata transactions. |
| [Cadence](../custom_components/matic_robot/plan_cadence.py) | Room schedule policy, progress and reservations. |
| [Catalog](../custom_components/matic_robot/plan_catalog.py) | Saved plans and areas, rotation and previews. |
| [Run control](../custom_components/matic_robot/run_control.py) | One actor per robot for its run, motion ownership, cancellation and stop fences; background start. |
| [Ledger](../custom_components/matic_robot/plan_ledger.py) | Run checkpoints, room accounting and native-history commits. |
| [History](../custom_components/matic_robot/plan_history.py) | Managed history projections and duration estimates. |
| [Recovery](../custom_components/matic_robot/plan_recovery.py) | Recovery checkpoints and dispatch evidence. |
| [Execution planning](../custom_components/matic_robot/execution_planning.py) | Execution previews and rotation target selection. |

[Plan model](../custom_components/matic_robot/plan_model.py),
[storage migrations](../custom_components/matic_robot/plan_storage.py) and
[timing](../custom_components/matic_robot/plan_timing.py) support those owners.
The [managed executor](../custom_components/matic_robot/managed_executor.py)
orchestrates runs through its dispatch, [leg](../custom_components/matic_robot/managed_leg.py), area, observation
and reconciliation modules. One leg runner runs a mission of one or more rooms and announces each room event.
The [run machine](../custom_components/matic_robot/run_machine.py) moves a run through its queue and says what to checkpoint, including the verifying write. After a restart, [recovery](../custom_components/matic_robot/restart.py) feeds the stored run to it as one `Restarted` event, which resumes the run at its checkpointed phase or ends it. An accepted or handoff run then continues in the executor's loop; a verifying leg only finishes its history read, since the loop would dock or start the next leg. One finalizer ends every run and announces `plan_finished`. Plan actions start a run through run control as a background task and return its `run_id` once the robot has the first command, or with `wait` when the run ends. Every run, new or restarted, registers with its robot's actor, which unload stops and awaits. The run starts legs and areas through a [robot port](../custom_components/matic_robot/robot_port.py)
with the [robot commands](../custom_components/matic_robot/robot_commands.py) the vacuum's clean starts use,
and observes the session's typed state through it, not Home Assistant entity state. Native history and [grouped reconciliation](../custom_components/matic_robot/grouped_native_reconciliation.py) match room evidence to an owned session. Completion and cadence credit require their own evidence; a UI update or an unnamed area summary is not room proof.
Each room the robot's history confirms, during the run or reconciled later, becomes one [verified completion](../custom_components/matic_robot/verified_completion.py), the only writer of its daily-limit receipt, rotation row, room statistics and cadence credit. Those stores keep different windows: receipts for 72 hours, rotation rows and statistics as running totals, and the shared schedule's replayable ledger.
See the [plan run contract](e2e-contract.md) and [cleaning results](native-cleaning-results.md).

## Home Assistant interfaces

[Services](../custom_components/matic_robot/services.py) compose action
registrations for execution, editing, controls and firmware. Their shared
[context](../custom_components/matic_robot/service_context.py) resolves targets
and authorization; [schemas](../custom_components/matic_robot/service_schemas.py)
and [plan preparation](../custom_components/matic_robot/service_plans.py)
validate and prepare requests. Local HTTP views use the shared
[entry lookup](../custom_components/matic_robot/http.py) and expose bounded,
authorized projections for [plans](../custom_components/matic_robot/plan_views.py)
and [areas](../custom_components/matic_robot/area_views.py). The [assistant APIs](../custom_components/matic_robot/llm.py)
are read-only status, control (status plus control tools, under 0.5's id) and firmware research; Assist gets status and control.
[Shared authorization](../custom_components/matic_robot/llm_common.py) admits current administrators and, on every path, only robots whose vacuum is exposed to the calling assistant.
Interface adapters do not establish independent cleaning or map truth. Actions, assistant tools, buttons and Photo patrol send direct commands through [robot controls](../custom_components/matic_robot/robot_controls.py), not `vacuum.send_command`, and like a vacuum action send nothing while the robot is unreachable; `vacuum.send_command` keeps the [documented commands](robot-command-actions.md), `resume` for Matic Map, and until 0.7 the deprecated clean and motion commands.

[Photo patrol](../custom_components/matic_robot/photo_patrol.py) checks privacy,
room, schedule and robot ownership before capture. The
[photo store and views](../custom_components/matic_robot/photos.py) keep a bounded
local cache and serve photos and previews. The [photo guide](photo-patrol.md)
describes the user controls and limits.

## Map Studio

The frontend's [HA adapter](../frontend/map-studio-v4/hass-adapter.ts) projects Home Assistant state, with the current room and run status from their sensors;
the [workspace store and coherence machine](../frontend/map-studio-v4/state.ts)
manage state, identity and admission. The [effect controller](../frontend/map-studio-v4/effects.ts)
routes Home Assistant admission and actions around that shared state. Separate
controllers own [workspace synchronization](../frontend/map-studio-v4/workspace-synchronizer.ts),
[catalog resources](../frontend/map-studio-v4/catalog-resources.ts),
[spatial reads and recovery](../frontend/map-studio-v4/spatial-resources.ts),
[motion](../frontend/map-studio-v4/robot-motion-controller.ts), room previews,
home shortcuts and run history. The [sheet controller](../frontend/map-studio-v4/sheet-controller.ts)
owns sheet interaction. The [renderer](../frontend/map-studio-v4/renderer-controller.ts)
owns the canvases and the frame loop; its camera, GPU resources, overlays,
robot mesh and hit-testing are modules beside it, held to a [frame cost](performance-frame-cost.md).
The [gesture controller](../frontend/map-studio-v4/gesture-controller.ts)
owns map interaction. Workflow, history and drawing assets load on demand.

The [map store](../custom_components/matic_robot/slam_map_store.py) owns live
admission and recovery. The [snapshot codec](../custom_components/matic_robot/slam_snapshot.py)
validates persisted maps without proving a live session. Client modules decode
[SLAM tiles](../custom_components/matic_robot/client/slam_tiles.py), encode
[scenes](../custom_components/matic_robot/client/slam_scene.py), and trace
[geometry](../custom_components/matic_robot/client/slam_geometry.py); HTTP views
serve authorized projections. Server-side [floor](../custom_components/matic_robot/floor_render.py)
and [SLAM](../custom_components/matic_robot/slam_render.py) renderers produce
local PNG projections; they do not authorize commands.

[Area binding](../custom_components/matic_robot/area_binding.py) relates saved
areas to a verified floor. Separate modules handle bounded
[geometry](../custom_components/matic_robot/area_binding_geometry.py), persisted
[record validation](../custom_components/matic_robot/area_binding_records.py)
and floor-scoped [Repairs](../custom_components/matic_robot/area_binding_repairs.py).

## Tests and delivery

[Testing](testing.md) says what each kind of test proves. Review and CI, a
check of the installed release, behavior on a real robot and the owner's
release approval are separate steps; see
[Contributing](../CONTRIBUTING.md#releasing).
