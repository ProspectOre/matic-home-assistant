# Matic 0.5 evidence matrix

Baseline: stable `v0.4.5` at `f15dfa2`, published 2026-09-25. This matrix is
the release ledger for the contract in `architecture-0.5.md`. No 0.5 exact
candidate evidence is recorded yet. Disposition and evidence are separate. “Preserved and verified” means the
accepted v0.4.5 contract remains covered by local source/regression checks; it
does not claim that each named 0.5 scenario has passed.
“Implementation required” means acceptance remains open even where partial
worktree implementation and local tests exist. “Deferred” names the boundary
and rationale. Every 0.5 candidate, device, owner, and runtime result remains
unverified until its evidence is recorded.

## Current implementation-worktree evidence

This is local branch evidence, not CI, an RC, owner acceptance, or release
proof. On 2026-09-25:

- `.venv/bin/pytest --cov=custom_components/matic_robot --cov-report=term-missing`:
  2,401 passed; 15,628 statements at 100.00% coverage, with no warnings.
- TypeScript typecheck and compiled bundle parity pass. The same-condition
  [performance comparison](performance-0.5.md) records 79,174 initial gzip bytes,
  11,382 lazy workflow bytes, and 1,897 lazy diagnostics bytes. The 90/30 KiB
  budgets pass. Three paired v0.4.5/worktree Chromium 151 desktop journeys show
  estimated input p95 of 32 ms baseline and 32–40 ms candidate. Two candidate
  tasks of 52–54 ms keep the task-duration gate open; three later traced runs
  did not reproduce them. These synthetic samples do not close runtime,
  mobile, frame/GPU, sustained-memory, or live transport performance gates.
- Ruff check/format, mypy, privacy scan, translation JSON/copy parity, and
  `git diff --check` pass. A clean sdist/wheel build passed release-artifact
  parity and fresh-install import checks, with 91 integration files matching
  byte-for-byte. All 722 browser cases pass across the full run and focused
  repairs: Chromium 358, desktop WebKit 277, Firefox safety 23,
  and mobile Chrome/WebKit emulation 32 each. Local and CI runs use two workers.
  Browser emulation does not establish real iOS Safari/Android Chrome acceptance;
  assistive-technology and owner acceptance remain open.
- Chrome DevTools: LCP 217 ms, CLS 0 on the synthetic harness; CrUX unavailable.
  Parser tests pass 5/5, including real-worker 1,500,000-point accept and
  1,500,001 reject. A 100-update HA regression observes zero workspace commits,
  panel updates/renders, or service requests; no sustained 100/s measurement.
- Independent read-only local reviews closed the identified findings in policy,
  executor, frontend admission, and build separation. One policy path supplies
  preview and dispatch; queued-room reservations, frozen Stop policy, retry,
  and late-response rejection have regressions. The snapshot carries a bounded selected-entry REST catalog; the
  adapter applies same-identity fields without spatial reload and synchronizes
  coherence, completeness, floor verification, and command guards. Browser
  tests show degraded health closes edit/motion without generation change or
  map reload. Status invalidations refresh only catalog. Transport remains off
  until live parity, resource budgets, and switchover evidence pass.
- Official Hassfest/HACS container validation and hosted CI remain open. The
  only reachable Docker engine runs an active separate-project control service
  with 2 CPUs/about 2 GiB RAM and no cached validator images; it was left intact.
  Exact candidate install, owner walkthrough, physical acceptance, mobile and
  live transport baseline, payload parity, and candidate/runtime evidence remain open.

| Requirement | Contract disposition | 0.5 evidence status | Evidence required; current gap |
|---|---|---|
| One mounted canvas and gesture stack for map, rooms, plans, Areas, and Full map | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Public browser workflows plus canvas/gesture identity through Areas, Full map, remount, resize, and context loss; candidate unknown. |
| One status strip, workflow, and contextual primary action across Ready, Locating, Active, Paused, Returning, Error, History, Offline, Access, No-robot, Unsupported, and Multi-robot | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | State-family component/browser matrix and command-gate tests; candidate owner interaction/language acceptance unknown. |
| Desktop inspector and safe-area mobile sheet with detents, scroll ownership, and responsive layouts | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | 320/360/390/600/768/1024/1440, portrait/landscape tablet, real iOS Safari and Android Chrome; no 0.5 runtime receipt yet. |
| Reversible Full map through toolbar, Escape, HA Back, and browser Back | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Pointer/keyboard/popstate matrix must preserve floor, camera, selection, draft, history, workflow, status, Stop, and focus; unknown. |
| One generation owns entry/floor/mission/resource identity | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Ordered A→B→A, stale response, return-leg, two-entry and rapid-transition fault injection; old generations must update nothing. |
| Central fail-closed live-map, pose, edit, and motion selectors | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Auth/admin loss, stale identity, wrong floor, renderer/transport failure, no robot, and unsupported rendering; no command guard may relax. |
| History is dated, floor-scoped, read-only, pose-free, and bounded | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | `slam_history.py` bounds of 12 items and 48 MiB compressed, eviction, live/history races, explicit Return to Live, and oversized-scene rejection; candidate unknown. |
| Room/list parity, accessible forms for every new behavior, map-space drawing, geometry invariance, and precision envelope | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Every cadence/setup/recovery/history action works without map input; numeric zoom, explicit Pan, focal zoom, scale bar, brush cursor, pointer cancellation, 100/400/1000% zoom, 0.20–2.50 m brush, undo, and no accidental paint. |
| HA semantics, safe areas, RTL, localization, zoom/reflow, reduced motion, forced colors, and screen readers | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Chromium/WebKit/Firefox safety workflows, light/dark/RTL/forced colors, 2.5x text, 200/400% zoom, VoiceOver/NVDA, and serious/critical scan count zero; unknown. Confirm HA-native tokens and supported panel interfaces, local dependency bundling, and capability-tested internal HA component fallbacks. |
| Shell, lazy workflows/diagnostics, input, main-thread, frame, memory, and GPU budgets | Preserved and verified (baseline) | Bundle/input budgets pass; task-duration and runtime acceptance open | Same-condition tag/worktree desktop journeys and split-chunk measurements are in performance-0.5.md. Candidate estimated p95 is 32–40 ms across three 100-input runs; two 52–54 ms tasks were not reproduced by diagnostic traces and remain open. The synthetic gallery is excluded from production; harness and panel share compiled modules. Tablet/live baseline, ≥55/≥30 fps, and heap/GPU stability remain unmeasured. |
| Worker fallback, bounded parsing, transferable buffers, incremental uploads, WebGL loss, and cleanup | Preserved and verified (baseline) | Parser boundaries and fallback/disposal regressions pass; runtime acceptance open | Five local tests cover no-worker fallback, worker error recovery, transfer ownership, six idempotent dispose cycles, and real-worker 1.5M accept/1.500001M reject. A connected-admin lifecycle regression adds 20 real plan/draw/history/floor transitions and unmounts: workers and object URLs balance, popstate listeners return to zero, and late floor results cannot revive disposed state. Decompression/WebGL runtime failures and bounded heap/GPU remain unverified. |
| HA adapter avoids unrelated fetch/store/render churn | Preserved and verified (baseline) | Local 100-update regression passes; sustained runtime acceptance open | 100 sequential unrelated HA state replacements produce zero workspace commits, panel updates/renders, or service calls. Sustained 100 updates/s and live HA instrumentation remain unmeasured. |
| Local-only privacy, admin access, pinned identity, bounded data, and redaction | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Auth loss, hostile payload/geometry, multi-entry isolation, diagnostics allowlist, privacy scan, and no private identifiers/maps in evidence; candidate unknown. |
| Credentials, entities, actions, automations, plans, Areas, preferences, and additive storage migration | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Old plan/Area fixtures, clean upgrade, reload/unload, rollback, saved-state parity, exact file fingerprints, no unsafe unload motion, cadence disabled on upgrade, and no cadence progress derived from historical aggregate counters; candidate unknown. |
| Direct Bluetooth pairing, stale-bond recovery, and scoped BlueZ agent | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Success, malformed, rejected, expired, cancelled, unavailable-adapter, stale-bond recovery, and reauthentication paths in pairing/config-flow tests; preserve credentials and prove recovery without logging or exposing passkeys; candidate/runtime proof remains unknown. |
| Managed outcomes, rotation, native per-mode completion, bounded deduplication, stop/dock, and restart recovery | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | `docs/e2e-contract.md`, native MCP evidence, same run/floor identity, no duplicate dispatch, bounded 64-key completion receipts independent of Activity, exact delayed reconciliation, and unchanged user stop intent; candidate unknown. |
| Atomic versioned workspace snapshot and coherent subscription | Implementation required | Local implementation and synthetic parity tests pass; exact-candidate acceptance open | Shared REST serializer supplies a bounded selected-entry projection; the browser validates and applies command-guard fields only when map identity matches. Producer tests cover schema/capabilities, typed status/recovery, identity/revisions, authorization, replay, overflow, publishers, unload, and restart; consumer tests cover cursor replay, field parity, stale data, and entry isolation. Runtime authorization, actual HA resource limits, and exact-candidate evidence remain open. |
| Stream ordering, stable cursors, gap/overflow detection, bounded queues, backoff, cleanup, resync, and REST/poll fallback | Implementation required | Local implementation and synthetic lifecycle tests pass; resource/candidate evidence open | Consumer tests cover stale/duplicate events, gaps, epochs, overflow, reconnect, and disposal; the gated adapter routes invalidations to authenticated resource-specific reads, refreshes command-guard projections without spatial reloads, and reloads caches on resync. Synthetic tests cover unsupported snapshot/subscription fallback through the real REST catalog adapter and HA fetchWithAuth, with no global fetch; admin loss stops timers/retries and disposal is idempotent. Live HA fallback and resource budgets remain unmeasured. |
| Explainable preview and dispatch | Implementation required | Partial local worktree evidence; parity and release acceptance open | Same deterministic order/settings/reasons, current-run order separate from next preview, stale-preview rejection, completed/partial/unattempted/unknown results, and unknown causes kept unknown. |
| Independent per-room mopping cadence | Implementation required | Partial local worktree evidence; parity and release acceptance open | Backend policy, private/shared progress, due-work resolution, resets, and reconciliation have local tests. N is 1–100; new N=3 is due on clean three; **Do on next clean** is separate; edits/resets lock during execution/reconciliation. Map Studio and HA options explain creating shared progress at zero, joining/adopting it, and starting fresh private progress. New/changed shared saves require verified floor/room bindings; stale-map compatibility is limited to unchanged existing participants, and a rejected add preserves the draft without allocating a saved-plan ID. Full N=1/N=3, scope, restart, partial/due mop, delayed evidence, and candidate acceptance remain open. |
| Independent per-room coverage cadence | Implementation required | Partial local worktree evidence; parity and release acceptance open | Backend/UI paths and combination/readback tests are present. N is 1–100; next-clean override and edit locks apply; coverage/mopping resets remain separate. Map Studio and the HA options flow explain creating a shared schedule at zero, joining/adopting progress, and starting fresh private progress. All normal/periodic combinations, both due, partial modes, delayed history, restart, edit/reset, and interrupted-due acceptance remain open. |
| Tracked Map Studio room run uses managed safety/accounting | Implementation required | Partial local worktree evidence; parity and release acceptance open | Ephemeral room run is an explicit opt-in that keeps existing service behavior compatible; shared schedule, override, identity, and readback have tests. OEM, physical, and custom-area starts receive no cadence credit. Stop/dock, restart, native proof, and exact HACS candidate remain open. |
| Setup, onboarding, first-clean guidance, robot/entry selection, activity, firmware, offline, support, and recovery journeys | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Exercise zero/one/multiple robots, isolated multi-robot selection, pairing and reauthentication, first successful clean guidance, firmware drift, HA/robot offline, permissions, entry removal, and actionable support/recovery; candidate unknown. |
| Security/resource backlog and review-gate prerequisite | Implementation required | Partial local worktree evidence; parity and release acceptance open | Before opening the 0.5 implementation PR, the open inventory contained only #138, the external review-gate prerequisite. The source roadmap’s former 22-open-security-PR count and PR list are historical and must not be treated as current open work. Reconcile #138 status, exact-head regular review, privacy/packaging/Hassfest/HACS, hostile payload/geometry, burst stream, stale sessions, bounded CPU/memory, and fail-closed behavior on the same candidate. |
| Required repository and frontend checks | Implementation required | Partial local worktree evidence; parity and release acceptance open | Python coverage 100%; Ruff lint and format; mypy; browser and architecture-contract checks; privacy check; packaging parity; Hassfest; HACS validation. Record exact candidate, command/CI run, result, and any waiver; none is established by test counts alone. |
| Bluetooth proxy pairing | Deferred with rationale | Outside 0.5 scope | Proxy bonding is unsupported; direct host adapter remains the supported pairing boundary. |
| New guessed robot commands, cloud services, wholesale redesign, and mutation API replacement | Deferred with rationale | Outside 0.5 scope | No demonstrated 0.5 need; retain vetted commands and HA service boundary. Reconsider mutation only after evidence of an unsolved stale-write/workflow limitation. |

## Inherited scenario coverage

The broad requirements above are dispositions, not blanket proof. Each family
below closes only with its own evidence; all 0.5 candidate results are
currently unknown. Row references point to the full independent review’s
edge-case matrix and quality plan.

| Scenario family | Contract disposition | 0.5 evidence status | Required evidence and source rows |
|---|---|---|
| Resource/map failures | Preserved and verified (baseline) | Local source regression verified; named 0.5 acceptance evidence unverified | Stale catalog/scene/delta/pose/history, delta-base expiry, incomplete/truncated/limited maps, degraded stream, new mission on the same floor, absent pose, and older-generation pose; ordered fault injection and browser/property tests. Review rows 163–173. |
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

The roadmap gates are independent and ordered. No gate is closed by test
counts, screenshots, a merge, download success, or one synthetic transition.

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

For any physical run, record explicit owner authorization, preflight and
post-run administrator MCP/native plan/operations/history evidence, no running
automations/scripts, bounded scope, run identity, STOP settlement and
correlated DOCK, guarded failure outcome, and before/after cleanup receipts.
The platform merge is manual and follows exact-head regular `@codex review`
and required CI. Stable is published only from the same accepted commit after
candidate/runtime and physical gates pass. Security-review availability or
completion is separate from regular review.

Binding sources: Matic Map Studio Roadmap, Matic Map Studio Independent Review,
the full 2026-08-29 independent review, and [managed-run contract](e2e-contract.md).

The roadmap’s v0.4.4 release metadata and former 22-open-security-PR inventory
are historical snapshots. This 0.5 ledger uses the verified stable `v0.4.5`
release at `f15dfa2` (published 2026-09-25); the pre-implementation-PR inventory
contained only #138. The project wiki card links to this contract and
evidence matrix and identifies the active implementation branch; it is not
candidate or release evidence.

## Performance and privacy rules

The 90/30 KiB, ≤100 ms input p95, 50 ms main-thread task, 55/30 fps,
12/48 MiB, queue, and memory values are budgets to measure, not current claims.
Suggested one-second status p95,
three-second resync p95, and 70% fewer control requests remain hypotheses until
the baseline justifies them. Timings and counters stay local and exclude maps,
coordinates, names, credentials, addresses, serials, and identifiers.
