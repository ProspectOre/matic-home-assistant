# 0.4 product review

Status: in progress; not a claim of complete end-to-end or physical acceptance.
Baseline: PR #97 merged as `82fb4b9`; work: `feature/complete-product-review`.
Authority: redesign structure and workflows where evidence supports it.
Live walkthrough uses the actual signed-in HA; synthetic states are regression
fixtures, never evidence of deployed behavior. RC10 remains installed.

## Principles

- Preserve the user's exact target; identifiers are not display labels.
- Scope asynchronous reads, writes, drafts and preferences to their owner.
- A changed context cannot accept a stale operation's result.
- Separate native room identity from coordinate-based area validation.
- Recovery never replays a possibly accepted motion command automatically.
- Keep Stop reachable; distinguish request acceptance from physical completion.
- Use native, labelled controls with predictable focus and responsive layouts.
- Evaluate empty/error/loading states as product screens, not exceptions.
- Each acceptance claim names its evidence and remaining limitations.

## Coverage ledger

| Surface | Review focus | Current evidence |
| --- | --- | --- |
| Setup/configuration | Pairing, cancellation, errors, options | Inventory; detailed pass pending |
| Home Assistant entities/actions | Availability, targeting, metadata | Inventory; detailed pass pending |
| Task chooser and map header | Discoverability, theme, touch, navigation | Native visual pass; dark fallback defect reproduced |
| One-time room clean | Stable target, per-room settings, one dispatch | Stable IDs preserved; mobile choices open visibly |
| Saved plans | Save/edit/delete/order/enable, recovery | Live editor inspected; stale mutation results fenced |
| Drawing/custom areas | Tools, coordinates, review, persistence | Live review inspected; duplicate and stale mutations fenced |
| History/floor switching | Read-only identity, return to live, drafts | Source review underway |
| Diagnostics/support | Useful redacted output, recovery routes | Source review underway |
| Stop/completion | Ownership, uncertainty, cancellation, credit | Baseline tests; physical matrix still open |
| Themes/accessibility | Contrast, keyboard, focus, zoom, forced colors | Header regressions added; broader pass underway |
| Preferences/lifecycle | Detach, identity changes, persistence | Owner-scoped writes and draft clearing regressions pass |
| Architecture | Contracts/state/effects/rendering boundaries | 32 TS modules, no local import cycles; client has no HA imports; lifecycle fixes tested |
| Packaging/upgrades | Artifact parity, HACS, cache changes | Baseline checks; new candidate checks pending |
| Hardware | Multi-leg, area, interruption, floor round trip | Open; see acceptance-0.4.md |

## Findings and fixes

1. Header fallback stayed white in dark mode while text became light. Reproduced
   in Chromium and WebKit. Shared surface/text tokens now follow the theme;
   regression includes explicit Home Assistant header color pairs.
2. Room selections were converted to names and missing rows silently filtered.
   Preserve stable IDs and complete target intent at the service boundary.
3. Plan saves lack the context fencing already used by motion requests.
   Prevent delayed completions from modifying a different robot/user workspace.
4. Debounced preferences read the current user key at timer execution instead
   of the owning key at scheduling. Correct ownership and verify switching.

5. The narrow room workflow opened with its list hidden. Open at half height so
   choices are immediately available; drawing retains its map-focused peek.
6. Area mutations accepted late results and repeated deletes. Fence their
   results, including selection after catalog refresh, and suppress duplicates.
7. Catalog replacement overwrote the previous entry before comparing floor
   boundaries. Compare against the captured previous entry; clear the old scene,
   selections and drafts on a real floor change. Same-floor refreshes retain them.
8. Account/robot changes and lost access now clear private drafts and invalidate
   pending results, including responses from backends that ignore cancellation.
9. Live area review's **All tasks** returned to drawing. It now opens the chooser;
   the separate **Edit outline** action remains the route back to drawing.

10. A newly rendered narrow floor selector defaulted to the first option even
    while a saved floor was displayed. Initialize selected options explicitly.
11. Review found two incomplete floor-change cleanup paths: invalidate motion
    responses and settle timers, and close old dialogs/precision/full-map layers.
    Regressions cover late success, late failure, timers and open top layers.

12. Cancelling a pending plan mutation during saved-floor navigation left the
    command pending forever. Resource cancellation now clears pending mutation
    state before late results are ignored.
13. Controller recreation forgot retained workspace ownership. Store the owner
    with the workspace, preserving same-owner drafts and clearing other owners.

14. A temporarily unknown floor ordinal is not evidence of a floor change.
    Retain the draft's last verified floor through revalidation, keep coordinate
    writes unavailable, and clear only when a different floor is verified. Same-floor
    area catalog refreshes also preserve unsaved edits to an existing outline.

15. Clearing private state now also resets saved-floor mode, its label and the
    managed-lock flag. Account changes, lost access and removed robots cannot
    leave a stale floor name or an unusable Return to live action.

16. Context changes now queue a replacement for an aborted forced catalog
    request. Preference writes flush for their original owner before account
    switches or panel disposal, preserving rapid changes without crossing users.
    Cancelling a mutation also clears its pending progress notice.

17. Request deadlines now cover response bodies and decoding, so stalled
    catalog, scene and delta responses settle on timeout or cancellation.

Validation: 1,263 Python tests at 100% coverage; 395 browser checks; strict
TypeScript, Ruff, format, MyPy and public-tree privacy checks passed during this
pass. Archive parity and fresh installation imports pass. Hosted review and live
candidate installation remain pending.

Live baseline: actual HA reopened with verified map/pose, six saved plans and
docked/clean native readback. Saved-plan editor inspected without changing its
settings or issuing motion. Saved-floor viewing and return to the live map were inspected without motion.
New fixes remain local until candidate installation.
