# Matic architecture

This guide maps the 0.6 source boundaries. It describes implementation, not
release or physical-device acceptance. The [0.5 authority contract](architecture-0.5.md)
and its linked receipts retain the decisions and evidence for that release.

## Integration and robot

Home Assistant owns setup, entity and service lifecycles. The integration keeps
robot traffic local, validates and pins the robot's identity, and cleans up its
resources on unload. The [Hermes transport](../custom_components/matic_robot/client/transport.py)
owns the pinned connection and bounded message decoding;
[telemetry](../custom_components/matic_robot/client/telemetry.py) decodes robot
state and native cleaning summaries. The coordinator and map store admit current
floor and mission state; cached geometry alone cannot establish the current floor.

## Plans and completion

[CleaningPlanManager](../custom_components/matic_robot/plans.py) composes five
owners sharing one repository:

| Owner | Responsibility |
| --- | --- |
| [Repository](../custom_components/matic_robot/plan_repository.py) | Durable state and admitted metadata transactions. |
| [Cadence](../custom_components/matic_robot/plan_cadence.py) | Room schedule policy, progress and reservations. |
| [Catalog](../custom_components/matic_robot/plan_catalog.py) | Saved plans and areas, rotation and previews. |
| [Run control](../custom_components/matic_robot/run_control.py) | Runtime ownership, cancellation and stop fences. |
| [Ledger](../custom_components/matic_robot/plan_ledger.py) | Run checkpoints, room accounting and native-history commits. |

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

[Services](../custom_components/matic_robot/services.py) register actions;
[schemas](../custom_components/matic_robot/service_schemas.py) validate inputs
and [plan preparation](../custom_components/matic_robot/service_plans.py)
resolves saved-plan requests. Local HTTP views use the shared
[entry lookup](../custom_components/matic_robot/http.py) and expose bounded,
authorized projections for [plans](../custom_components/matic_robot/plan_views.py)
and [areas](../custom_components/matic_robot/area_views.py). Assistant tools use
[shared authorization and robot resolution](../custom_components/matic_robot/llm_common.py),
with separate [control](../custom_components/matic_robot/llm_control.py) and
[firmware](../custom_components/matic_robot/llm_firmware.py) tools. Interface
adapters do not establish independent cleaning or map truth.

[Photo patrol](../custom_components/matic_robot/photo_patrol.py) checks privacy,
room, schedule and robot ownership before capture. The
[photo store and views](../custom_components/matic_robot/photos.py) keep a bounded
local cache and serve photos and previews. The [photo guide](photo-patrol.md)
describes the user controls and limits.

## Map Studio

The frontend's [HA adapter](../frontend/map-studio-v4/hass-adapter.ts) projects
Home Assistant state; the [workspace store and coherence machine](../frontend/map-studio-v4/state.ts)
manage state, identity and admission. The [effect controller](../frontend/map-studio-v4/effects.ts)
owns reads, subscriptions and commands. The
[renderer](../frontend/map-studio-v4/renderer-controller.ts) owns the canvas and
GPU resources; the [gesture controller](../frontend/map-studio-v4/gesture-controller.ts)
owns map interaction. Presentation and rendering math live in separate pure
helpers. Workflow, history and drawing assets load on demand. The server-side
[floor](../custom_components/matic_robot/floor_render.py) and
[SLAM](../custom_components/matic_robot/slam_render.py) renderers produce local
PNG projections; they do not authorize commands.

## Evidence and delivery

[Simulated robot tests](e2e-harness.md) exercise integration paths, and the
[installed check](installed-check.md) and [upgrade drill](upgrade-drill.md)
provide separate installation and rollback evidence. Review and CI, installed
runtime checks, physical behavior and owner release approval are independent
boundaries; see [review and manual merge](maintenance-reviews.md).
