# Matic 0.5 evidence matrix

Baseline: public stable `v0.4.6` at `52166df`. The paired desktop performance
comparison intentionally retains `v0.4.5` as its measured control. This ledger belongs to
`architecture-0.5.md`; no 0.5 RC runtime evidence is recorded. “Preserved and
verified” means v0.4.6 regressions remain covered, not every 0.5 scenario. “Implementation required” means acceptance is open despite partial code/tests; “Deferred” names the boundary and reason. Candidate, device, owner, and runtime results remain unverified.

## Current implementation-worktree evidence

Local evidence is not RC, owner, or release proof. Refreshed on 2026-09-27:

- Code candidate `658a0f7` follows the stable v0.4.6 baseline (`52166df`); HACS
  and Python package metadata say `0.5.0`. The full suite passes 3,534 tests at
  100% (15,832 statements), plus Ruff, format, strict mypy (61 files), privacy,
  and clean-staging build/archive/fresh-import checks. The browser flake fix now
  passes 10 Chromium, 3 WebKit, and 3 Firefox-safety repeats; exact-head full CI
  remains pending. Tracked starts bind a generated UUID to command and
  active-session identity, then compare goal values. Hermes has no verified
  plan-generation marker, so matching is consistency-only: it never credits
  periodic coverage, due coverage stays due, and legacy proof flags are discarded.
  Preview aborts release logical FIFO turns while a two-wire cap remains until
  actual settlement. Malformed cadence, legacy repair, save serialization, and
  coherence/cancellation regressions remain covered.
- Packaged-panel recovery saves/reads/reopens the 100-room repair in
  Chromium/WebKit. Six focused preview timeout/abort/cap cases pass in
  Chromium, WebKit, and Firefox safety (18 project cases); the snapshot adapter
  suite passes all eight Chromium cases, including first-snapshot loss, fencing,
  catalog recovery, and later invalidation. Paired size/input/heap evidence is
  in [performance-0.5.md](performance-0.5.md). Final-head CI and clean regular
  review remain required before merge.
- The prior Python CI collection failure came from an inherited test importing
  `RoomRunOutcome` through `services` after its canonical ownership moved to
  `managed_executor`. The matrix now imports the owner and injects a typed waiter
  per execution; no duplicate service authority or global test monkeypatch is kept.
- Ownership checks cover candidate cancellation, shared transport errors, firmware
  persistence failure/cancellation, overlapping writers, floor revocation and
  A→B→A generations, Area writes, scene revisions, cadence flags, preview parity,
  and recovery after an active map read is invalidated. Python and TypeScript use
  one synthetic workspace wire fixture.
- Brush previews belong to rendering; only a completed, admitted gesture can
  change the immutable draft. Generation, tool, permission, and baseline changes
  reject obsolete edits. Independent local review identified the preview/store
  ownership defect; cancellation and retained-draft regressions cover its repair.
- The [paired performance comparison](performance-0.5.md) records the current
  compiled asset fingerprints, identical synthetic scenes, size/input
  measurements, and unresolved task-duration gate. Desktop lab measurements do
  not establish mobile, frame/GPU, sustained-memory, or live transport budgets.
- Parser tests cover no-worker recovery, ownership/disposal, and real-worker
  1,500,000-point accept / 1,500,001 reject. A 100-update HA regression observes
  zero workspace commits, component updates/renders, or service requests.
- One policy path supplies preview and dispatch. Queued-room reservations,
  frozen Stop policy, retry, and stale-response rejection have regressions.
  The snapshot projects the bounded selected-entry REST catalog; degraded health
  closes edits/motion without a generation change or spatial reload. An empty,
  unverified initial snapshot now advances the fence, closes pose/edit/motion,
  and revalidates the catalog before controls recover. Status invalidations
  refresh only the catalog. Transport stays off until live parity, resource
  budgets, and switchover evidence pass.
- Exact-candidate install, owner walkthrough, assistive technology, physical
  Android/iOS, live transport baseline, and robot acceptance remain open.
  Review-infrastructure #138 remains blocked on the shared policy in dev-workspace
  #48 and authenticated review/inline-event capture; candidate-controlled workflow
  logs do not establish provenance. The unsigned listener prototype is unpublished.

| Requirement | Contract disposition | 0.5 evidence status | Evidence required; current gap |
|---|---|---|
| One mounted canvas and gesture stack for map, rooms, plans, Areas, and Full map | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Public browser workflows plus canvas/gesture identity through Areas, Full map, remount, resize, and context loss; candidate unknown. |
| One status strip, workflow, and contextual primary action across Ready, Locating, Active, Paused, Returning, Error, History, Offline, Access, No-robot, Unsupported, and Multi-robot | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | State-family component/browser matrix and command-gate tests; candidate owner interaction/language acceptance unknown. |
| Desktop inspector and safe-area mobile sheet with detents, scroll ownership, and responsive layouts | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | 320/360/390/600/768/1024/1440, portrait/landscape tablet, real iOS Safari and Android Chrome; no 0.5 runtime receipt yet. |
| Reversible Full map through toolbar, Escape, HA Back, and browser Back | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Pointer/keyboard/popstate matrix must preserve floor, camera, selection, draft, history, workflow, status, Stop, and focus; unknown. |
| One generation owns entry/floor/mission/resource identity | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Ordered A→B→A, stale response, return-leg, two-entry and rapid-transition fault injection; old generations must update nothing. |
| Central fail-closed live-map, pose, edit, and motion selectors | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Auth/admin loss, stale identity, wrong floor, renderer/transport failure, no robot, and unsupported rendering; no command guard may relax. Exact-candidate command journeys must also prove single-fire dispatch, visible pending state, ownership-aware controls, bounded timeout, and reachable Stop when permitted. |
| History is dated, floor-scoped, read-only, pose-free, and bounded | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | `slam_history.py` bounds of 12 items and 48 MiB compressed, eviction, live/history races, explicit Return to Live, and oversized-scene rejection; candidate unknown. |
| Room/list parity, accessible forms for every new behavior, map-space drawing, geometry invariance, and precision envelope | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Every cadence/setup/recovery/history action works without map input; numeric zoom, explicit Pan, focal zoom, scale bar, brush cursor, pointer cancellation, 100/400/1000% zoom, 0.20–2.50 m brush, undo, and no accidental paint. |
| Explicit room-sequence bound | Implementation required | New plans, cleaning, command options, and previews enforce 100 rooms; legacy plans up to the parser bound can only be saved through strict monotonic reduction with unique existing room IDs | Python service coverage proves equal-size replacement and duplicate IDs fail, 102→101→100 succeeds, new 101-room plans fail, and malformed persisted room containers can be replaced safely. Packaged-panel browser coverage now reduces 102 rooms to 100, submits and reads back the 100-room plan, and reopens it. Exact-candidate compatibility and owner recovery walkthrough remain open. Whole-floor commands preserve their existing behavior. |
| HA semantics, safe areas, RTL, localization, zoom/reflow, reduced motion, forced colors, and screen readers | Preserved and verified (baseline) | Settled light/dark Axe scans report zero serious/critical findings in Ready and cadence-edit states across Chromium, WebKit, Firefox safety, and mobile emulation; manual acceptance remains open | The scan uses reduced-motion emulation to make theme auditing deterministic and drove selected-control and secondary-text contrast fixes. Custom HA theme combinations, RTL, localization with 2.5× text expansion, safe areas, 200/400% zoom, VoiceOver/NVDA, and broader assistive-technology coverage remain open. Confirm HA-native tokens and supported panel interfaces, local dependency bundling, and capability-tested internal HA component fallbacks. |
| Shell, lazy workflows/diagnostics, input, main-thread, frame, memory, and GPU budgets | Preserved and verified (baseline) | Bundle/input budgets pass; task-duration and runtime acceptance open | Same-condition paired desktop journeys and split-chunk measurements are in performance-0.5.md. Across six candidate runs, input p95 is 32 ms and no task reached 50 ms; one of six baseline runs recorded a 50 ms task. Keep the task-duration gate open because these lab samples do not establish routine behavior. A separate trusted-pointer follow-up verifies canceled-draft preservation but records a 147 ms compositor wait; headed samples have no routine task above 50 ms. These results do not establish mobile or sustained runtime acceptance. The synthetic gallery is excluded from production; harness and panel share compiled modules. Tablet/live baseline, ≥55/≥30 fps, and heap/GPU stability remain unmeasured. |
| Worker fallback, bounded parsing, transferable buffers, incremental uploads, WebGL loss, and cleanup | Preserved and verified (baseline) | Parser boundaries and fallback/disposal regressions pass; runtime acceptance open | Five local tests cover no-worker fallback, worker error recovery, transfer ownership, six idempotent dispose cycles, and real-worker 1.5M accept/1.500001M reject. A connected-admin lifecycle regression adds 20 real plan/draw/history/floor transitions and unmounts: workers and object URLs balance, popstate listeners return to zero, and late floor results cannot revive disposed state. Decompression/WebGL runtime failures and bounded heap/GPU remain unverified. |
| HA adapter avoids unrelated fetch/store/render churn | Preserved and verified (baseline) | Local 100-update regression passes; sustained runtime acceptance open | 100 sequential unrelated HA state replacements produce zero workspace commits, panel updates/renders, or service calls. Sustained 100 updates/s and live HA instrumentation remain unmeasured. |
| Local-only privacy, admin access, pinned identity, bounded data, and redaction | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Auth loss, hostile payload/geometry, multi-entry isolation, diagnostics allowlist, privacy scan, and no private identifiers/maps in evidence; candidate unknown. |
| Credentials, entities, actions, automations, plans, Areas, preferences, and additive storage migration | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Old plan/Area fixtures, clean upgrade, reload/unload, rollback, saved-state parity, exact file fingerprints, no unsafe unload motion, cadence disabled on upgrade, and no cadence progress derived from historical aggregate counters; candidate unknown. |
| Direct Bluetooth pairing, stale-bond recovery, and scoped BlueZ agent | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Success, malformed, rejected, expired, cancelled, unavailable-adapter, stale-bond recovery, and reauthentication paths in pairing/config-flow tests; preserve credentials and prove recovery without logging or exposing passkeys; candidate/runtime proof remains unknown. |
| Managed outcomes, rotation, native per-mode completion, bounded deduplication, stop/dock, and restart recovery | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | `docs/e2e-contract.md`, native MCP evidence, same run/floor identity, no duplicate dispatch, bounded 64-key completion receipts independent of Activity, exact delayed reconciliation, and unchanged user stop intent; candidate unknown. |
| Atomic versioned workspace snapshot and coherent subscription | Implementation required | Local implementation and synthetic parity tests pass; exact-candidate acceptance open | Shared REST serializer supplies a bounded selected-entry projection; the browser validates and applies command-guard fields only when map identity matches. Producer tests cover schema/capabilities, typed status/recovery, identity/revisions, authorization, replay, overflow, publishers, unload, and restart; consumer tests cover cursor replay, field parity, stale data, and entry isolation. Runtime authorization, actual HA resource limits, and exact-candidate evidence remain open. |
| Stream ordering, stable cursors, gap/overflow detection, bounded queues, backoff, cleanup, resync, and REST/poll fallback | Implementation required | Local implementation and synthetic lifecycle tests pass; resource/candidate evidence open | Consumer tests cover stale/duplicate events, gaps, epochs, overflow, reconnect, and disposal; the gated adapter routes invalidations to authenticated resource-specific reads, refreshes command-guard projections without spatial reloads, and reloads caches on resync. Synthetic tests cover unsupported snapshot/subscription fallback through the real REST catalog adapter and HA fetchWithAuth, with no global fetch; authorization blocks invalidations and uses a bounded snapshot probe for reauthentication; reconnect and disposal remain idempotent. Live HA fallback and resource budgets remain unmeasured. |
| Explainable preview and dispatch | Implementation required | Partial local worktree evidence; parity and release acceptance open | Same deterministic order/settings/reasons, current-run order separate from next preview, stale-preview rejection, completed/partial/unattempted/unknown results, and unknown causes kept unknown. |
| Independent per-room mopping cadence | Implementation required | Local policy/edit/recovery and packaged-panel save/reopen regressions pass; runtime acceptance open | N=1/N=3, private/shared interval edits, paused progress, fresh/shared adoption, mode-bound late/restart evidence, and duplicate credit have regressions. The Chromium/WebKit/Firefox-safety panel flow now exercises visible save/reopen, scope changes, next-clean selection, and cadence disable/re-enable; its stateful synthetic catalog applies the submitted service payload. Python tests verify backend canonicalization. `test_clean_room_sequence_schedule_selection_controls_shared_accounting` omits the schedule opt-in for the ordinary service case and verifies shared progress does not advance; `test_robot_normalization_repairs_cadence_records_without_inventing_progress` verifies legacy plans remain cadence-free until explicitly configured. N is 1–100; **Do on next clean** and resets stay separate; execution/reconciliation locks edits. Verified bindings gate new/changed shared saves; unchanged participants preserve compatibility, and rejected additions retain drafts without allocating plan IDs. Exact-candidate and interrupted-due acceptance remain open. |
| Independent per-room coverage cadence | Implementation required | Policy resolution, edit/recovery, and packaged-panel regressions pass; coverage credit remains fail-closed pending causal protocol evidence | Quick/Optimal/Heavy Duty normal/periodic combinations resolve in preview and dispatch. Private/shared interval edits, pause/resume, mode-bound reconciliation, and duplicate-credit guards are tested. A matched active-session UUID plus goal values is not causal proof; completions therefore leave due coverage scheduled and it may be requested again on later cleans until a versioned or otherwise verified setting signal exists. The panel tests selection and submitted payload, not robot acceptance. N is 1–100; edits and separate resets remain covered. Runtime acceptance is open. |
| Tracked Map Studio room run uses managed safety/accounting | Implementation required | Local policy/accounting regressions pass; runtime acceptance open | Ephemeral room run is an explicit opt-in that keeps existing service behavior compatible; shared schedule, override, session identity, and current-goal comparison have tests. The comparison cannot clear due coverage without causal evidence. A service-to-history regression proves custom-area completion can update room opportunity without advancing shared cadence. OEM and physical starts receive no cadence credit. Stop/dock, restart, native proof, and exact HACS candidate remain open. |
| Setup, onboarding, first-clean guidance, robot/entry selection, activity, firmware, offline, support, and recovery journeys | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Exercise zero/one/multiple robots, isolated multi-robot selection, pairing and reauthentication, first successful clean guidance, firmware drift, HA/robot offline, permissions, entry removal, and actionable support/recovery; candidate unknown. |
| Security/resource backlog and review-gate prerequisite | Implementation required | Partial worktree evidence; release acceptance open | The roadmap’s former 22-PR count is historical. Review-infrastructure #48 is at `f95ffcb`, with its canonical policy check running and no review request for that head; the coordinator requires a refreshed diagnosis. Matic #138 is at `1064d58`; the coordinator requires quota recovery before another request. Trusted create/edit/delete review capture still needs signed relay/support #326 and live provenance proof; default-branch issue-comment events have a trusted native path. Keep the gate fail-closed until authenticated exact-head child manifests and delivery completeness are proved. Preserve adverse finding history; unsigned workflow logs and routing tests do not qualify as capture evidence. |
| Required repository and frontend checks | Implementation required | Local coverage/static/privacy/package/fresh-import checks pass; targeted browser flake fix passes repeated Chromium/WebKit/Firefox-safety runs; exact-head CI and regular review pending | Python coverage 100%; Ruff lint and format; mypy; browser and architecture-contract checks; privacy; `python -m build --sdist --wheel`; `scripts/check_release_artifacts.py dist`; `scripts/check_fresh_install.py dist`; Hassfest; HACS. Record exact candidate, command/CI run, result, and any waiver; test counts alone do not establish quality. |
| Bluetooth proxy pairing | Deferred with rationale | Outside 0.5 scope | Proxy bonding is unsupported; direct host adapter remains the supported pairing boundary. |
| New guessed robot commands, cloud services, wholesale redesign, and mutation API replacement | Deferred with rationale | Outside 0.5 scope | No demonstrated 0.5 need; retain vetted commands and HA service boundary. Reconsider mutation only after evidence of an unsolved stale-write/workflow limitation. |

## Inherited scenario coverage

The broad requirements above are dispositions, not blanket proof. Each family
closes only with its own evidence; all 0.5 candidate results are unknown. Rows
refer to the full independent review’s edge-case matrix and quality plan.

| Scenario family | Contract disposition | 0.5 evidence status | Required evidence and source rows |
|---|---|---|
| Resource/map failures | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Stale catalog/scene/delta/pose/history, delta-base expiry, incomplete/truncated/limited maps, degraded stream, new mission on the same floor, absent pose, older-generation pose, and an empty unverified initial snapshot racing a retained coherent REST map; ordered fault injection verifies fencing, disabled controls, catalog recovery, and later invalidation. Review rows 163–173. |
| Setup, entry/floor catalog, labels, state families, and initial map selection | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Zero/one/multiple robots and entries, isolated switching, zero/one/multiple classified floors, duplicate/long/unicode/RTL/unavailable customer labels, and disambiguation; component and browser evidence. Review rows 153–162. |
| Auth, offline, unload, restart, BFCache, visibility, tabs, and entry removal | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | HA disconnect, robot unreachable, authentication/administrator loss, reload/unload, HA restart, Browser Back, pagehide/BFCache, hidden tab, multiple tabs, and removed entry; runtime/browser lifecycle evidence with all protected actions off. Review rows 174–184 and 193. |
| Vendor, managed command, and activity states | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Vendor-app start, managed-plan lock, service rejection, missing command confirmation, pause/return/stop/settlement, and unknown external cause; command journal plus native/MCP evidence. Review rows 206–209 and `docs/e2e-contract.md`. |
| Area and plan conflicts | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Stale Area binding, create-name conflict, external Area deletion, plan-save conflict, dirty-draft protection, and no silent overwrite; 404/409/component/contract tests. Review rows 202–205. |
| History lifecycle and races | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Eviction while viewed, Live→History, History→Live, floor-scoped read-only pose-free state, and explicit Return to Live; ordered race/property/browser tests. Review rows 210–212. |
| Full map and responsive shell preservation | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Resize/orientation, Full map entry/exit, transition while expanded (Locating retains only exit control), access/no-robot/unsupported exit; preserve canvas, floor, camera, selection, draft, history, workflow, primary action, and focus. Review rows 190–193. |
| Renderer, worker, decompression, CPU, GPU, and large-scene faults | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | WebGL unavailable/context loss, GPU pressure, slow CPU/network, very large scene, worker unavailable, and decompression unavailable; fallback, progressive upload, memory/GPU stability, and seeded large-scene evidence. Review rows 185–190 and 220–222. |
| Touch, keyboard, assistive technology, RTL, zoom, and draft input | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Pointer cancellation, pinch handoff, Draw precision, wheel/Space navigation, accidental paint, draft exit/transition, locale/RTL, 200/400% zoom, screen reader, keyboard/switch, reduced motion, and forced colors; public-contract browser, VoiceOver/NVDA, and visual evidence. Review rows 194–201 and 213–217. |
| Performance, privacy, delivery, runtime, rollback, and physical acceptance | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | HA firehose with zero unrelated work, privacy-safe support, install/update/rollback, exact runtime readback, and current→second classified map→current physical proof with labels/pose/history/actions and no repeated Repair. Review rows 218–220; quality plan rows 265–281. |

## Gate sequence and release receipts

The roadmap gates are independent and ordered; test counts, screenshots, a merge, download success, or one synthetic transition do not close a gate.

| Gate | Closing evidence |
|---|---|
| A — Baseline/budgets | Reproducible v0.4.5 and Samsung-tablet measurements for latency, traffic, reconnect, stalls, memory, GPU, and recovery; numerical budgets and known physical gaps recorded. |
| B — Snapshot contract | Atomic admission, typed errors/reasons, authorization, parity, multi-entry isolation, old storage/service compatibility, and contract tests. |
| C — Compatible adapter | Reversible switch, visible-state parity, unchanged command guards, and working legacy/v1 fallback. |
| D — Live transport | Loss, duplicate, reorder, gap, overflow, restart, reconnect, floor transition, backoff, cleanup, polling fallback, and budget evidence before default switchover. |
| E/E2/E3 — UI and cadence | Public-contract browser/accessibility evidence plus explainable results, cadence scope/reset/persistence, preview/dispatch parity, and guarded due-work behavior. |
| E4 — Security | Reconciled backlog, clean exact-head review and required CI, privacy/packaging/Hassfest/HACS, hostile-input/resource evidence, and fail-closed behavior. |
| E5 — Independent product/architecture review | Independent written review of the exact candidate; zero unresolved P0/P1 findings, with each finding dispositioned and any repair re-reviewed on the updated head. |
| E6 — Owner interaction/language acceptance | Separate owner walkthrough and acceptance of setup, common cleaning, recovery, accessibility, and user-facing language; record remaining limitations. |
| F — Exact candidate/runtime | HACS beta pre-release loaded version and reviewed SHA, rollback copy, installed-tree fingerprint, restart/readback, reconnect/map coherence, exact changed-flow proof, and current → second classified map → current with correct labels/pose/history/actions, no wrong-floor fallback, and no repeated Repair. These runtime and physical gates remain open until evidence is recorded. |

For physical runs, record explicit owner authorization, pre/post administrator
MCP/native plan, operations and history evidence, no active automations/scripts,
bounded scope and run identity, STOP settlement/correlated DOCK, guarded failure,
and cleanup receipts. Merge manually after exact-head regular review and green CI;
publish stable from that accepted commit only after runtime and physical gates pass.
Security review is separate from regular review.

Binding sources: Matic Map Studio Roadmap, Matic Map Studio Independent Review, the full 2026-08-29 review, and [managed-run contract](e2e-contract.md).

The roadmap’s v0.4.4 metadata and former 22-open-security-PR inventory are
historical. This ledger uses public stable `v0.4.6` at `52166df`; the paired
desktop comparison uses `v0.4.5` at `f15dfa2` as its performance control. Before
the implementation PR, the only open item was #138. The wiki card links to this
contract and matrix and identifies the active branch; it is not release proof.

## Performance and privacy rules

The 90/30 KiB, ≤100 ms input p95, 50 ms main-thread task, 55/30 fps, 12/48 MiB,
queue, and memory values are budgets, not claims; suggested one-second status p95, three-second resync p95, and 70% fewer control requests remain hypotheses until the baseline justifies them. Timings stay local and omit maps, coordinates, names, credentials, addresses, serials, and identifiers.
