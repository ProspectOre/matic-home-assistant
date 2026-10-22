# 0.5 custom-area continuity qualification

**Status: OPEN. Stable release certification is withheld.**

## Intended behavior

A saved area remains usable across routine cleaning runs, supported map
refinements, integration reloads, and Home Assistant restarts. These events
must not require repeated confirmation or silently rewrite the area. A changed
floor, displaced coordinate frame, changed room association, or insufficient
historical evidence must remain blocked until reviewed.

## Candidate scope

The RC35 change is based on reviewed main
`37d1cf03cbf2526344b5561e12e26c77dd455ea9` (RC34). The accompanying PR and CI
records identify the exact candidate head; this document alone is not a
completed review or installation receipt.

For the same mission, current v3 and v6 bindings can now survive simultaneous
partition-identity and unrelated geometry changes after anchored validation.
V3 requires complete room-frame snapshots for this exception. Saved/current
room identities and each room's circle associations must match exactly. Fresh
circle validity and immutable area shape remain mandatory. A stronger proof
uses unique, distributed turn contexts at the same saved millimeter positions
to establish the absolute frame through ordinary contour refinements. Weak
frame evidence retains the existing local-geometry checks. Fresh bounded bindings use version 6, adding an immutable circle-multiset
digest before refinement recovery. Legacy v5 bindings retain their original
local-hash and frame checks; their anchors are not silently rebased. Legacy
bindings without adequate historical evidence retain their review requirement.

Existing frame/local checks run before optional witness work. Witness work
is admitted atomically only when needed and affordable; unchanged and
retessellated large contours retain their established fallback.
For multi-room v6 areas with an unchanged aggregate local hash, legacy-valid
rooms retain their proof and only failed frames need stronger witnesses.
An aggregate local-hash mismatch still requires strong proof of every room;
incomplete or changed circle-room associations cannot count as missing work.

The change also closes a v3 association gap: an additional room covering saved
circles can no longer pass merely because all original anchors still match.
It does not add automatic rebinding or coordinate transformations.

## Source evidence

The assembled PR #287 candidate passed **5,278 tests with 100.00% coverage**
across 20,147 statements (`python -m pytest --cov=custom_components/matic_robot
--cov-report=term-missing`). Exact-head PR CI and complete regular review must
pass before merging. Installed RC35, RC36 and RC37 retesting is recorded below.

- Binding regressions cover partition churn, unrelated room changes,
  containing-room contour reshaping, fractional wall refinements, new overlaps,
  translations, room rekeys, missing historical evidence, and older versions.
- Persisted v3/v6 integration cases cover manager refresh, real HA Store reload,
  readiness, plan preview and service validation with unchanged areas and no
  area writes or robot commands. Unsafe cases remain blocked.
- Actual setup-listener cases cover repeated safe refreshes for v3 and v6,
  scheduled manager reconciliation, no new HA Repair, no Store save, and a
  valid saved-plan preview. These are controlled integration fixtures.
- Migration defensive guards are checked independently as well as through the
  stricter normal status path. No production guard was removed for coverage.
- Legacy v3 records may omit the optional global-frame digest. Their original
  local validation remains usable; strong recovery requires that digest and
  safely reports changed geometry when it is absent. Persistence, reload,
  readiness, preview and service-validation regressions cover this format.
- Multi-room v3 areas finish every legacy frame check before any optional
  witness query. A two-circle regression exercises both anchor orders and a
  retessellated 1,204-point room whose frame query exceeds 10,000 work units.

## Installed and physical evidence

Rows marked RC34 belong to the observed RC34 run. RC35 rows were observed on the
installed RC35 prerelease (2026-10-21) through read-only Home Assistant reads and
on-screen checks; no robot command was sent. Private raw
receipts retain timestamps, plan/area identities, session fingerprints, state
hashes, command journals, and preservation evidence. Private map data is not
included here.

| Gate | Result |
|---|---|
| RC34 installation and restart | Pass: all 110 integration files match reviewed source; credentials/options, 77 entity identities, YAML and plan-store bytes preserved. |
| RC34 loaded runtime and frontend | Pass: 64 loaded source modules / 1,352 observed functions match installed source; 22 served frontend assets match. Whole-process verification is explicitly excluded. |
| One-time current-map recovery | Pass: explicit owner review, same saved area ID and unchanged geometry/settings; ready readback and mixed-plan preview. |
| Supervised completion run | Pass: room then custom area, independent area-session fingerprint match, verified completion, final docked/native-idle state. |
| Immediate post-run continuity | Pass before floor-plan refresh: unchanged area/binding and valid preview. This did not establish continuity once the refined contours were fetched. |
| Automation-service repeat | Pass for start: same saved plan started through `matic_robot.run_selected_plan` without intervening area confirmation/save/rebind. |
| Owner Stop during repeat area | Pass: matching active area session, attributed managed Stop, no additional area completion credit; final charging/native-idle state with lock and Stop settlement cleared. |
| Idle integration reload continuity | **Fail:** saved area/binding unchanged, but newly fetched contours return `geometry_changed` and block preview. Mission/partition session key and room IDs remain stable. |
| Full Home Assistant restart continuity | **Fail for readiness:** area/binding remain unchanged; the same geometry blocker persists. HA restarts successfully and the robot remains docked. |
| Home shortcut recovery | **Fail after integration reload:** stored pins and catalog IDs remain intact, but the existing page hides both shortcuts. Fresh page load restores them; full HA restart also restores them. |
| RC35 exact-head CI and complete regular review | Pass: PR #287 CI green on the merged head. |
| RC35 owner manual merge and installation | Pass: owner merged #287; RC35 published as a prerelease with RC34 retained for rollback; installed through HACS, `update.matic_unofficial_update` reports v0.5.0-rc35. |
| RC35 full Home Assistant restart continuity | Pass: the saved custom area reports `current` after restart with no confirmation, save or rebind. |
| RC35 idle integration reload continuity | Pass: the same area remains `current` across two integration reloads. |
| RC35 Home shortcut recovery | Pass: on the same open page, both saved shortcuts return within 30 to 90 seconds of a reload, after a read-only "Locating" interval. A tab already stalled before the reload stayed on "Map unavailable" until refreshed; that tab had been disturbed by test scripting and is not counted as a product result. |
| RC35 stale position | Pass: a native pose about 13 hours old reports `pose_observation_current=false` and no robot marker is drawn. |
| RC35 installed room colors | Pass for colors: room fills are distinct. **Fail for labels:** later room fills clipped two adjacent room names and hid a third label. Fixed in PR #293 for RC36. |
| RC36 installation and label recheck | Pass: installed through Home Assistant updates after a HACS refresh; `update.matic_unofficial_update` and the integration report 0.5.0rc36; after restart the saved area reports `current`, both shortcuts show, no stale marker is drawn, and previously clipped names show in full. One small room's 2D label was still hidden by label-collision suppression (present since before RC35); RC37 moves colliding labels aside. |
| RC37 installation and label recheck | Pass: installed through Home Assistant updates after a HACS refresh; `update.matic_unofficial_update` reports 0.5.0rc37 and the integration entry is loaded after restart; the saved area reports `current`; both shortcuts show. In 2D with Room colors and with Photo, all twelve room names draw, including the small room that RC36 hid, with no overlapping labels. A map opened in a background browser tab showed "Map unavailable" until the tab was brought forward, after which the map loaded without a manual retry. |
| Final physical/owner acceptance and stable publication | Open. |

## Reproduced release blockers

Routine post-run contour refinement changed the containing-room bounds by up
to 90 mm, its local occupancy and segment evidence, while retaining the same
map session and room associations. The initial RC35 partition fix also rejected
this recorded pair. Offline replay accepts the recorded contours with the area
and binding unchanged. It reconstructs room IDs from saved anchors/API identities;
installed RC35 readbacks report the saved area `current` after a full restart and
two integration reloads with no confirmation, save or rebind. Do not use another
confirmation to conceal a failure.

The shortcut failure is a frontend recovery problem, not demonstrated storage
loss. The returning same-user/same-entry lifecycle now rereads saved pins in source.
The packaged-panel regression passes Chromium and WebKit with no preference
writes or robot commands. Installed RC35 retesting passed: both shortcuts return
on the same page after an integration reload.

## Room-color readability

The 2D room palette now starts with sixteen perceptually separated colors and
uses stronger fills. All 256 supported rooms retain distinct colors. Room IDs
preserve assignment under metadata reordering. The backend carries its stable
room identity through the actual scene parser; production-format reorder and
legacy/duplicate-ID fallbacks are tested. All 256 supported rooms are exercised
through the real parser, including the input room-count cap. Two-pixel neutral boundaries
separate rooms, with a three-pixel selection boundary. Forced colors retain the
system palette. Chromium and WebKit checks cover uniqueness, first-sixteen
OKLab separation, selection, labels, dark mode and forced colors; synthetic
12-room light/dark captures were visually inspected. Installed RC35 inspection
confirmed distinct fills but found room names clipped by later room fills; RC36
draws every name after all fills, with a draw-order regression. The Node 24 startup graph is 92,138 bytes on 24.19.0
and 91,984 on 24.22.0, within the unchanged 92,160-byte budget. Developer notes no longer ship inside
a rendered HTML template. Syntax-aware build compaction removes ordinary HTML
newline whitespace while preserving expressions, escapes and preformatted text;
thirteen Node tests and the Browser workflow cover this build step.

A real 256-room, tile-clipped map regression reproduces the metadata ceiling
crossing introduced by room IDs. Lossless integer-coordinate serialization
preserves every room and fractional center while reducing its metadata from
1,050,719 to 739,423 bytes. Encoder and header parser share the unchanged 1 MiB
limit; an unrepresentable scene returns the existing explicit error path.
The encoded regression also passes through the real Chromium and WebKit scene
parsers with all identities, 256-byte room names and geometry intact. Native
room-name limits now follow the backend's 256 UTF-8 bytes in scenes, catalogs
and previews; user-created area/plan name limits remain unchanged.

## Boundaries

Source fixtures establish supported refinement behavior; the observed RC34 run
establishes its named live sequence only. Neither proves every firmware/map
transition. Larger containing-room boundary changes that no longer establish
the saved absolute frame remain blocked. A firmware coordinate-frame migration
would require a separately proven transform, not a relaxed validation check.

The historical PR #283 pre-merge review-sequencing gap remains recorded in the
[recovery receipt](verification-0.5-area-recovery.md). New reviews do not repair
that historical sequence. The broader [acceptance matrix](acceptance-0.5.md),
[position qualification](verification-0.5-pose-provenance.md), [Gate F run sheet](owner-gate-f-run-sheet.md), and
[manual-merge contract](maintenance-reviews.md) continue to apply.
