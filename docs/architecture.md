# Matic architecture

This guide maps the 0.6 source boundaries. It describes implementation, not
release or physical-device acceptance. The [0.5 authority contract](architecture-0.5.md)
and its linked receipts retain the decisions and evidence for that release.

## Integration and robot

Home Assistant owns setup, entity and service lifecycles. The integration keeps
robot traffic local, validates and pins the robot's identity, and cleans up its
resources on unload. The [Hermes client](../custom_components/matic_robot/client/api.py)
composes the pinned [connection](../custom_components/matic_robot/client/hermes_connection.py),
collection transport, decoded reads and validated commands. Bounded telemetry
decoders handle robot state and native cleaning summaries.
[Discovery](../custom_components/matic_robot/config_flow_discovery.py) selects
a certificate-bound address; [vacuum catalogs](../custom_components/matic_robot/vacuum_catalog.py)
map Home Assistant areas to floor-scoped rooms. The
[coordinator](../custom_components/matic_robot/coordinator.py) publishes robot,
floor and session snapshots; [robot health](../custom_components/matic_robot/robot_health.py)
derives confirmed errors and alerts. Cached geometry alone cannot establish
the current floor.

## Plans and completion

[CleaningPlanManager](../custom_components/matic_robot/plans.py) composes
these owners around one repository:

| Owner | Responsibility |
| --- | --- |
| [Repository](../custom_components/matic_robot/plan_repository.py) | Durable state and admitted metadata transactions. |
| [Cadence](../custom_components/matic_robot/plan_cadence.py) | Room schedule policy, progress and reservations. |
| [Catalog](../custom_components/matic_robot/plan_catalog.py) | Saved plans and areas, rotation and previews. |
| [Run control](../custom_components/matic_robot/run_control.py) | Runtime ownership, cancellation and stop fences. |
| [Ledger](../custom_components/matic_robot/plan_ledger.py) | Run checkpoints, room accounting and native-history commits. |
| [History](../custom_components/matic_robot/plan_history.py) | Managed history projections and duration estimates. |
| [Recovery](../custom_components/matic_robot/plan_recovery.py) | Recovery checkpoints and dispatch evidence. |
| [Execution planning](../custom_components/matic_robot/execution_planning.py) | Execution previews and rotation target selection. |

[Plan model](../custom_components/matic_robot/plan_model.py),
[storage migrations](../custom_components/matic_robot/plan_storage.py) and
[timing](../custom_components/matic_robot/plan_timing.py) support those owners.
The [managed executor](../custom_components/matic_robot/managed_executor.py)
orchestrates runs; its dispatch, room, grouped-leg, area, observation and
reconciliation modules hold the corresponding execution steps. Native history
and [grouped reconciliation](../custom_components/matic_robot/grouped_native_reconciliation.py)
match room evidence to an owned session. Completion and cadence credit require
their own evidence; a UI update or an unnamed area summary is not room proof.
See the [plan run contract](e2e-contract.md) and
[cleaning results](native-cleaning-results.md).

## Home Assistant interfaces

[Services](../custom_components/matic_robot/services.py) compose action
registrations for execution, editing, controls and firmware. Their shared
[context](../custom_components/matic_robot/service_context.py) resolves targets
and authorization; [schemas](../custom_components/matic_robot/service_schemas.py)
and [plan preparation](../custom_components/matic_robot/service_plans.py)
validate and prepare requests. Local HTTP views use the shared
[entry lookup](../custom_components/matic_robot/http.py) and expose bounded,
authorized projections for [plans](../custom_components/matic_robot/plan_views.py)
and [areas](../custom_components/matic_robot/area_views.py). Assistant API
registration uses [shared authorization](../custom_components/matic_robot/llm_common.py)
and separate modules for control, firmware, plan, history and status tools.
Interface adapters do not establish independent cleaning or map truth.

[Photo patrol](../custom_components/matic_robot/photo_patrol.py) checks privacy,
room, schedule and robot ownership before capture. The
[photo store and views](../custom_components/matic_robot/photos.py) keep a bounded
local cache and serve photos and previews. The [photo guide](photo-patrol.md)
describes the user controls and limits.

## Map Studio

The frontend's [HA adapter](../frontend/map-studio-v4/hass-adapter.ts) projects
Home Assistant state; the [workspace store and coherence machine](../frontend/map-studio-v4/state.ts)
manage state, identity and admission. The [effect controller](../frontend/map-studio-v4/effects.ts)
routes Home Assistant admission and actions around that shared state. Separate
controllers own [workspace synchronization](../frontend/map-studio-v4/workspace-synchronizer.ts),
[catalog resources](../frontend/map-studio-v4/catalog-resources.ts),
[spatial reads and recovery](../frontend/map-studio-v4/spatial-resources.ts),
[motion](../frontend/map-studio-v4/robot-motion-controller.ts), room previews,
home shortcuts and run history. The [sheet controller](../frontend/map-studio-v4/sheet-controller.ts)
owns sheet interaction. The [renderer](../frontend/map-studio-v4/renderer-controller.ts)
owns the canvas and GPU resources; the [gesture controller](../frontend/map-studio-v4/gesture-controller.ts)
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

## Evidence and delivery

[Simulated robot tests](e2e-harness.md) exercise integration paths, and the
[installed check](installed-check.md) and [upgrade drill](upgrade-drill.md)
provide separate installation and rollback evidence. Review and CI, installed
runtime checks, physical behavior and owner release approval are independent
boundaries; see [review and manual merge](maintenance-reviews.md).
