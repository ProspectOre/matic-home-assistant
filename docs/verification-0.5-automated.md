# RC9 automated evidence boundaries

PR #191's reviewed head and RC9 `c5daa6d` share the same tree. Its passing
browser job rebuilt and diff-checked the committed frontend before running
867 passing browser cases. Python passed 3,661 tests at 100% coverage.
This card identifies concrete contracts within that result; it does not
claim every [acceptance scenario](acceptance-0.5.md) is closed.

| Concern | Exact-candidate contract evidence |
|---|---|
| Backend ownership | [test_managed_executor_architecture.py](../tests/test_managed_executor_architecture.py): standalone client has no HA imports; execution/restart do not depend on service registration; execution and operations do not reselect prepared policy |
| Snapshot admission | [test_workspace_wire_contract.py](../tests/test_workspace_wire_contract.py) and [workspace_wire_contract.spec.mjs](../tests/browser/workspace_wire_contract.spec.mjs): Python snapshot fixture and frontend admission agree |
| Generation and stale results | [map_studio_v4_quality.spec.mjs](../tests/browser/map_studio_v4_quality.spec.mjs), [map_studio_v4_manual_preview.spec.mjs](../tests/browser/map_studio_v4_manual_preview.spec.mjs), [map_studio_v4.spec.mjs](../tests/browser/map_studio_v4.spec.mjs): stale admission, preview races and coherent resource fences |
| Authorization and lifecycle | [workspace_effects_adapter.spec.mjs](../tests/browser/workspace_effects_adapter.spec.mjs), [workspace_transport_lifecycle.spec.mjs](../tests/browser/workspace_transport_lifecycle.spec.mjs), [map_studio_v4_lifecycle.spec.mjs](../tests/browser/map_studio_v4_lifecycle.spec.mjs): auth loss/recovery, obsolete stream results and 20 panel lifecycles |
| Stream recovery | [workspace_transport.spec.mjs](../tests/browser/workspace_transport.spec.mjs): replay, duplicates/stale cursors, gaps/epochs, reconnect, overflow, backoff, malformed messages, disposal; [test_workspace_socket.py](../tests/test_workspace_socket.py): admin access, entry isolation/removal, replay bounds and cleanup |
| Compatible fallback | [workspace_transport_fallback.spec.mjs](../tests/browser/workspace_transport_fallback.spec.mjs): unsupported snapshot/subscription preserves authenticated REST polling and command locks |
| Parser/worker resilience | [scene_parser_resilience.spec.mjs](../tests/browser/scene_parser_resilience.spec.mjs): unavailable/failed worker fallback, buffer transfer, 1.5M-point boundary and idempotent URL/worker disposal |
| Drawing and presentation | [map_studio_v4.spec.mjs](../tests/browser/map_studio_v4.spec.mjs): map-space input, cancellation, navigation, draft/selection preservation and responsive presentation |
| Accessible presentation | [map_studio_v4_nonphysical_acceptance.spec.mjs](../tests/browser/map_studio_v4_nonphysical_acceptance.spec.mjs): localized RTL at 200/400% effective-viewport equivalents, reduced motion, forced colors, keyboard dismissal, focus restoration and dirty drafts |

Playwright projects cover Chromium, WebKit, Firefox safety cases and emulated
iPhone/Pixel viewports. Protocol-only tests explicitly run in Chromium.
Device emulation and effective viewport scaling do not prove real Android/iOS
safe areas, native browser zoom, VoiceOver/NVDA, switch operation or owner acceptance.

These are synthetic/browser contracts, distinct from installed HA/robot proof.
Live transport remains default-OFF until installed fault/fallback parity and
final numerical resource gates pass. Counted cleanup does not prove sustained
CPU/heap/GPU bounds. RC9 hardware Stop and active-restart completion receipts
are scoped in the acceptance ledger; cadence, physical map transitions and
broader guarded failures remain separate.

## Follow-up fault qualification

The bounded audit found missing context-loss/restoration and malformed compressed
delta journeys in RC9's suite. [map_studio_v4_renderer_faults.spec.mjs](../tests/browser/map_studio_v4_renderer_faults.spec.mjs)
adds two tests against those same packaged production bytes:

- Real WebGL loss paints a Canvas2D fallback, retains one canvas, nonempty room
  selection and camera, then restores WebGL; no service is dispatched. The
  pixel check isolates a magenta scene point with pose/scene rooms omitted.
  Scene-layer screenshots hide the overlay only during capture, then restore
  its visibility, proving WebGL pixels before loss and after restoration.
  Suppressing fallback compositing fails the loss check; suppressing restored
  drawing while retaining fallback pixels fails the isolated scene check.
  All mutations are removed from the committed test.
- Working native deflate support is confirmed before malformed compressed
  bytes enter the packaged delta path. Recovery receipts and unchanged scene
  revision/current coherence prove containment; no service is dispatched.

Final serial targeted runs passed both cases in Chromium, WebKit and Firefox
safety (six cases). The unchanged 20-lifecycle case passed prior-head CI. A later
local run timed out at its configured 30 s limit; a 90 s diagnostic passed in
47.2 s, which does not qualify the configured limit or establish the cause.
An earlier concurrent engine run timed out during Firefox fixture setup; both
failures are retained and not counted as passes. The fixture's delta option is opt-in;
existing defaults remain unchanged. No production defect or code change was
needed. This follow-up is qualified for merge only by its own exact-head review and CI.

Artificial context loss and malformed bytes do not establish sustained GPU
pressure, seeded large-scene rendering, real-device recovery or resource bounds.

## Unreleased authority refinements

These source changes follow RC9 and PR #192; they are not installed RC evidence.
Independent bounded reviews cover the completion transaction and frontend
selection/notification ownership. The inherited-source cross-walk found no
additional P0/P1 contract omission in its slice; it does not close the full
product/device/owner review gate.

- Dispatch freezes mode and coverage into durable reconciliation markers.
  Live and startup completion share one recorder and rollback/deduplication
  contract. Unknown, changed, or conflicting settings cannot qualify duration
  estimates; malformed present modes cannot become absent legacy modes.
  The final backend run passes 3,691 Python tests at 100% coverage.
- Packaged selection tests pass 18 cases across Chromium, WebKit and Firefox
  safety: pending robot selection, stale switchback, layer-history cleanup,
  administrator recovery with polling paused, pending entry removal, and an
  unavailable selected robot recovered only by an explicit remaining-robot choice.
  The pending-selection case failed against the preceding RC9 bundle at its
  intended assertion. An intermediate fixture used inconsistent per-entry
  response identities and is corrected; failed runs remain retained locally.
- A focused Chromium adapter/lifecycle run passes 49 cases, including the
  unrelated-HA-update contract and unavailable-map status consequences.
- Page suspension contracts pass in Chromium, WebKit and Firefox safety:
  generation revocation before cancellation, five seconds without hidden reads,
  stale response rejection, held-catalog resume, history/draft/camera retention,
  saved-plan preflight cancellation, listener disposal, and cancelled rendering
  and gesture inertia. Synthetic page events do not prove native BFCache.
- Transmitted plan/Area mutations survive mere page suspension and reconcile
  from fresh readback rather than retained catalogs. Response IDs identify new
  plans; 20-second acknowledgement bounds do not retry writes or bound a managed
  cleaning run. All 29 focused mutation contracts pass, including late ACK and
  disposer cancellation. A hidden cadence reset cannot restore stale one-shot flags.
- Persistent pose/delta recovery passes three combined engine cases: mismatched
  pose revokes the frame, a slow owned replacement is not repeatedly cancelled,
  and delta-only failure preserves verified position and command admission.
  Three content-revision cases separately preserve the coordinate-frame
  generation, camera and draft, reject obsolete scenes, and fence real frame changes.
- A dirty local staging build exposed retired UI files in its wheel. The build
  now creates the wheel from the fresh source archive; both clean archives pass
  exact-file parity and fresh-environment import. All 55 release contracts pass.

The final broad local sweep ran all 940 configured cases: 933 passed, four
failed at inherited identity/content expectations, and three WebKit navigations
timed out before app import. Those traces remain at about:blank without network
events; their driver/server cause is unproven. Matching fixtures and assertions
now express the authority contract. All 15 affected/adjacent cases pass the
focused follow-up at unchanged limits. Initial PR #193 head `5a92454` then passed
CI: 3,691 Python/100%, 939 browser passes and one capability skip whose case was
not identified by that reporter. Regular review found two valid Stop/selection
defects. Their repairs pass 30 focused Chromium/WebKit/Firefox safety cases:
selected HA activity enables Stop without a catalog, stale-entry work cannot
stop another idle robot, host configuration changes apply, and explicit user
selection survives refresh/cancellation. CI now logs case names alongside
annotations so future skips remain identifiable. These repairs require their
own exact-head review/CI. The [desktop lab receipt](performance-0.5-refinements.md)
is bounded to its compiled bundle and journey; runtime/acceptance remain open.

Head `5225068` passed Python/quality/package/HACS/Hassfest. Browser CI passed
948 cases, skipped Firefox's WebGL-loss case because its required capability
was absent, and failed one stale-start fixture in three engines. Its service
mock left B's newly permitted Stop unresolved. The corrected fixture holds B's
catalog, acknowledges exactly one Stop to B, requires pending settlement, and
proves A's late success/guard rejection cannot change B's command, notice or
selection. All 14 affected/neighbor cases pass at configured limits. An
intermediate misplaced fixture edit was corrected; its failed run remains
retained. No production bytes changed in this fixture repair. New-head CI/review
remain required, and a skipped capability is not verified support.
