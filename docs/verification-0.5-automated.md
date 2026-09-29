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
  Temporarily suppressing fallback image compositing makes that assertion fail;
  the mutation is removed from the committed test.
- Working native deflate support is confirmed before malformed compressed
  bytes enter the packaged delta path. Recovery receipts and unchanged scene
  revision/current coherence prove containment; no service is dispatched.

Final serial targeted runs passed both cases in Chromium, WebKit and Firefox
safety (six cases), plus the existing Chromium 20-lifecycle case. An earlier
concurrent engine run timed out during Firefox fixture setup; that failed run
is retained and not counted as a pass. The fixture's delta option is opt-in;
existing defaults remain unchanged. No production defect or code change was
needed. This follow-up is qualified for merge only by its own exact-head review and CI.

Artificial context loss and malformed bytes do not establish sustained GPU
pressure, seeded large-scene rendering, real-device recovery or resource bounds.
