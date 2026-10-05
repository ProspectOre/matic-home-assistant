# Retained HTTP adapter contract

Source qualification refreshed October 5, 2026. All eight routes below also
exist in `v0.3.12`. The retained route inventory is paired with focused local
results; it does not qualify an installed RC or close final full-CI, 100%
coverage, ordinary review, or runtime gates in the
[acceptance matrix](acceptance-0.5.md). Five Python adapter tests and 13 browser
cases passed. The Python cases cover administrator checks before Area body/store
access, cancellation before Area body acceptance, and cancellation propagation
and cleanup for pose/history reads and delta long polls. The browser cases use
the actual backend reader for malformed JSON, Area-save envelopes, truncated
live/history scene bodies, and invalid content type, revision, and floor headers.
Shared deadline and recovery evidence remains as recorded below.

All current route methods in [slam_scene.py](../custom_components/matic_robot/slam_scene.py)
use `require_admin`. The named handler tests below are in
[test_slam_scene.py](../tests/test_slam_scene.py). Shared authorization source
does not replace direct checks that mutation methods reject unauthorized users
before reading their bodies or changing stored data.

| Retained route | Existing named assertions | Remaining endpoint evidence |
|---|---|---|
| GET `slam_scene/{entry}` | `test_scene_view_serves_and_etag_caches_compact_private_payload`; `test_scene_and_catalog_require_admin_and_loaded_catalog_entries`; `test_scene_view_returns_conflict_until_photo_pages_exist`; `test_scene_cache_retains_two_transport_revisions`; `test_scene_revision_advances_when_room_metadata_changes`; `test_scene_build_survives_a_cancelled_http_waiter` | The shared client deadline matrix covers scene header/body stalls and cancellation. Focused browser cases now reject truncated live and history scene bodies through the actual backend reader. Server cancellation proves a lost waiter does not cancel the shared build. |
| GET `slam_pose/{entry}` | `test_pose_view_returns_exact_fallback_and_unavailable_positions`; `test_pose_view_coalesces_concurrent_live_reads_and_rechecks_runtime`; `test_pose_view_discards_result_if_entry_unloads_during_read`; `test_pose_view_hides_missing_entry_and_requires_admin`; browser `catalog, pose, history, and area parsers reject their own malformed root shapes` | The named browser contract rejects malformed pose freshness/position roots. Focused Python cases confirm cancelled pose reads propagate cancellation. Client timeout/recovery uses the shared JSON reader. |
| GET `slam_entries` | `test_scene_and_catalog_require_admin_and_loaded_catalog_entries`; browser `catalog, pose, history, and area parsers reject their own malformed root shapes` | The named browser contract rejects a malformed catalog root (`invalid-catalog-entries`). Shared client timeout/cancellation is covered; this synchronous projection has no mutation precondition or request body. |
| GET `slam_delta/{entry}` | `test_delta_view_streams_revision_change_and_full_fallback`; `test_delta_view_waits_bounds_query_and_handles_unload`; `test_delta_view_handles_initial_scene_failure`; `test_delta_view_revalidates_scene_after_wakeup`; `test_delta_view_publishes_during_same_mission_revision_churn`; `test_delta_view_discards_delta_after_live_session_invalidates` | Focused Python adapter coverage confirms delta cancellation propagates and removes both subscriptions. Malformed `since` and timeout-to-204 are covered; the delta decoder rejects truncated envelopes and bounded inflate overflow, with separate packaged malformed-delta recovery evidence. |
| GET `slam_history/{entry}` | `test_history_views_list_serve_hide_and_require_admin`; browser `catalog, pose, history, and area parsers reject their own malformed root shapes` | The named browser contract rejects a malformed history root (`invalid-history-floors`). Focused Python tests cover cancelled history reads. The synchronous metadata projection has no integration-owned async wait or mutation revision precondition. |
| GET `slam_history_scene/{entry}/{snapshot}` | `test_history_views_list_serve_hide_and_require_admin`; `test_history_scene_cancellation_propagates_to_store_read` | Focused browser cases reject truncated history-scene bodies through the actual backend reader. The named Python test confirms request cancellation propagates to the asynchronous store read. Missing or retired immutable snapshot IDs return 404. |
| GET/POST/DELETE `areas/{entry}` | `test_area_workspace_lists_current_and_stale_private_areas`; `test_area_workspace_saves_updates_and_deletes_validated_areas`; `test_area_workspace_rejects_malformed_saves`; `test_area_workspace_handles_missing_maps_entries_and_conflicts`; `test_area_workspace_rejects_floor_change_during_request_body_read`; `test_area_workspace_rejects_runtime_replacement_during_body_read`; `test_area_mutations_require_admin_before_body_or_store_access`; `test_area_post_cancellation_during_body_read_does_not_reach_store`; browser `catalog, pose, history, and area parsers reject their own malformed root shapes` | The named browser contract rejects a malformed Area root (`invalid-area-list`). Python tests establish authorization before Area body/store access and cancellation before body acceptance without mutation. Browser cases cover Area-save response envelopes. Actual-Store cancellation ownership and surfaced write failures are qualified separately below. |
| GET `plans/{entry}` | `test_plan_workspace_lists_saved_plans_and_current_rooms`; `test_plan_workspace_handles_missing_entry_and_floor_plan`; `test_plan_workspace_projects_malformed_persisted_cadence_safely`; `test_plan_workspace_skips_malformed_rooms_and_uses_safe_defaults` | Focused actual-reader browser cases cover shared malformed JSON; `backend_contracts.spec.mjs` exercises the distinct plans parser. Shared client lifecycle is covered. The synchronous projection has no caller body or asynchronous store wait; current-floor conflicts and malformed persisted data are covered. |

## Shared behavior and applicability

- `map_studio_v4_deadlines.spec.mjs` tests catalog, scene and delta header/body
  stalls, timeout, cancellation and body cleanup. Catalog exercises the JSON
  path shared by pose, history, plans and Areas; scene covers both live/history.
  Do not duplicate those tests per caller.
- `map_studio_v4_scene_delta_decoder.spec.mjs` covers malformed/truncated delta
  envelopes, bounded inflate, response headers and parser handoff;
  `map_studio_v4_renderer_faults.spec.mjs` covers delivered malformed compressed
  deltas and coherent-scene recovery. `map_studio_v4_spatial_recovery.spec.mjs`
  covers the controller's shared bounded pose/delta retry.
- Real-filesystem regression tests reproduced and repaired Area cancellation
  during persistence. Accepted commits now run in manager-owned tasks under the
  per-robot mutation fence and drain on unload/removal; cancelling the request
  waiter cannot cancel an accepted commit. Actual-Store serialization/filesystem
  failures now surface as a generic error, and rollback/retry tests prove durable
  state is unchanged on failure and exactly one credit is applied after retry.
  See [workspace and persistence contract qualification](verification-0.5-runtime-contracts.md).

- Authenticated REST polling and command locks are exercised by
  [workspace_transport_fallback.spec.mjs](../tests/browser/workspace_transport_fallback.spec.mjs),
  including administrator loss. The unsupported snapshot/subscription cases
  use a mocked backend.
- Abort signals and rejection of stale delta results are exercised by
  [workspace_transport_lifecycle.spec.mjs](../tests/browser/workspace_transport_lifecycle.spec.mjs).
  These establish controller behavior; focused Python adapter cases also
  verify handler cancellation propagation and listener cleanup.
- Read-only inventory/current-value responses and immutable snapshot URLs have
  no mutation revision precondition. Do not invent a conflict or revision API
  solely to fill a test cell. Preserve their actual unavailable/404 behavior.
- A handler with no body/query parser has no corresponding malformed-body
  branch. Its client still needs malformed/truncated response coverage where
  that endpoint's payload is decoded. Missing-entry/path handling remains a
  separate applicable check.
- Synchronous projection does not have an integration-owned asynchronous
  timeout or abort wait. Network timeout and reconnect still belong to the
  client adapter and must be mapped there.

The named tests above establish the specific malformed parser roots, backend
response cases, authorization ordering, and handler cancellation behavior they
exercise; they do not imply broader coverage than those assertions. The inherited
deadline/recovery results remain applicable. Full-candidate CI and 100% coverage,
ordinary exact-head review, RC qualification, and installed/runtime acceptance
remain separate gates; aggregate test counts do not close them.
