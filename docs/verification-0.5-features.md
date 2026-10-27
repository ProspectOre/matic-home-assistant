# Matic 0.5 feature evidence

This matrix maps every feature, upgrade change, and explicit deferral in
[the 0.5 release notes](release-notes-0.5.0.md). It distinguishes source tests,
current installed checks, robot runs and owner acceptance. A passing layer does
not imply another one passed. The full synthetic walkthrough used source head
`1e9e11aaae25603bce6ba802ff63df8405cbcc22`; the installed runtime remains
`5a1a93a2bee71af04cd5aaef941cef172de7d2f7`.

## Common completed evidence

The 5,485-test suite passes at 100% reported coverage, including native
composition tests for minor-11 plan storage migration through persist/reload and
for firmware blueprint import/save/reload with local service sinks. The
source-bound synthetic walkthrough passed all 117 journey/setup cells, 765
steps, and 85 accessibility-tree readouts. These results do not imply physical
device or screen-reader acceptance.

Native Safari checks used the owner's authenticated profile for 2D/3D, Photo/Room
colors, Full map/Escape, and owned-plan create/save/API readback, default
preservation, and fixture cleanup. Live cadence metadata checks passed for
bring-forward/skip previews, selective reset, private isolation, stale-token
schedule deletion and settings preservation. A single Matic-only reload also
preserved shared/private policies, bring-forward flags, previews, selection and
the firmware acknowledgement. All fixtures were cleaned. These metadata checks
do not establish the remaining one-time-clean physical cases.

Four bounded Dining Room physical passes completed and docked: Vacuum/Quick,
Vacuum/Optimal, shared N3 Vacuum+Mop/Heavy duty, and private N1
Vacuum+Mop/Optimal. Each had one Start and one verified room credit. Both mop
passes have completed native vacuum and mop results. Independent physical
coverage application was not verified. A live firmware blueprint test migrated
to the supported API while preserving the configured notification target,
namespace and existing file. Phone CHECK and ACK events were observed and the
native ACK receipt advanced. The owner confirmed notification clearing,
microphone input and a spoken response. The owner then requested iOS Maps-style
gestures: parallel vertical two-finger motion tilts 3D, while one finger pans.
The revised gesture/help code passes 16 Chromium and 16 WebKit focused cases,
including stationary-anchor and combined gestures. Installed iPhone acceptance
and refreshed full-walkthrough evidence for that change remain pending.

## Feature and upgrade matrix

| ID | Feature or change | Existing evidence | Remaining checks |
|---|---|---|---|
| environment.local-first | Local Home Assistant plans, maps and storage | Source contracts; installed preservation | Audit complete UI network destinations and local/offline behavior, including optional firmware research. |
| workspace.home-shortcuts | Pin, hide, reorder plans and areas | 117-cell synthetic walkthrough; browser contracts | Live HA shortcut create/reorder/reload preservation. |
| workspace.plan-run-edit | Run/Edit, previews, drafts and guarded save/discard/delete | 117-cell walkthrough; Safari owned-plan save/API readback; native storage tests | Live conflict/restart cases and full plan journeys in HA. |
| workspace.mixed-plans-order | Mixed rooms/areas, area-only, Smart and Saved order | Synthetic walkthrough; native sequence/persistence tests; earlier room→area run | Representative live mixed-plan ordering; measured drawn-area coverage. |
| workspace.map-views | 2D/3D, Photo/Room, selection and Full map | Synthetic walkthrough; native Safari 2D/3D, colors, Full map/Escape | Current iPhone/iPad/Android live selection and transition checks. |
| workspace.zoom-presets-help | Numeric zoom, Fit/presets, input help and camera stability | Synthetic walkthrough and browser interaction tests | Live reconnect/history/draft races; real pinch/touch camera behavior. |
| cadence.due-controls | Mop/vacuum intervals, bring-forward and reset | Synthetic walkthrough; native cadence tests; live metadata previews/resets/reload; N3 physical passes | One-time override and bring-forward mop completion in a bounded physical case; active-run restart is separate. |
| cadence.shared-private-delete | Shared/private scopes and safe schedule deletion | Native tests; live private isolation, stale-token delete, settings preservation and reload; physical shared/private sequence | Live affected-plan explanation and concurrent-edit cases retain their tested scope. |
| cadence.one-time-clean | Include/skip due work in an unsaved clean | Synthetic preview and native logic tests; live skip preview | Live dispatch/skip persistence and skipped-work remains due; any robot run needs a bounded plan. |
| cadence.verified-credit | Fail-closed partial/unconfirmed credit | Native accounting/readback tests; four physical room credits | Partial/stop/restart and contradictory-evidence cases; independent coverage application. |
| progress.verified-count-elapsed | Verified count, active time and scoped room estimate | Native timing tests; physical completion counts/timing; synthetic walkthrough | Live disconnect/restart estimates and matching-tier fallback states. |
| progress.time-display-tiers | Time units and retained mode/coverage tiers | Native migration/composition tests; installed duration-unit and timing checks; physical durations | Broader HA display contexts, migration interruption/rollback and full restore. |
| stop.smart-and-immediate | Threshold Smart Stop and immediate Stop override | Native tests; RC41 robot receipts retained with unchanged runner/cadence paths through the installed runtime | Retained proof is not a new robot invocation; broader settlement/fault cases remain bounded by their receipts. |
| results.persisted-outcomes | Incomplete/unverified results remain visible | Native and synthetic state tests | Current installed failed/interrupted/unknown outcomes through docking and HA reload. |
| responsive.readability-controls | Labels, compact layout, focus, drawing, rotation and large text | 117 synthetic cells and 85 accessibility-tree readouts; Chromium compact accessibility scan | Real iPhone/iPad/Android rotation/large text, VoiceOver/NVDA/switch, Windows High Contrast. |
| map.history-readonly-live-return | Dated, read-only saved maps and return to live | Native/browser contracts; installed live map check; synthetic walkthrough | Live floor/history transitions and outage recovery; confirm no stale pose after restore. |
| map.area-recovery-position | Area rebinding only when location is verified; hide stale pose | Native/browser recovery tests; synthetic walkthrough; earlier room→area physical run | Live map revision/rebind and stale-pose transition checks without cleaning. |
| ha.device-triggers | Room/Plan/Cleaning-finished automations | Native import/save/reload tests with inert sinks | Confirm actual robot event triggers each automation once on the current install. |
| ha.actions-states-editor | Familiar actions and clearer automation states | Native registry/service dispatch tests; installed entity preservation | Live editor inspection and real transport outcomes, diagnostics and error/Cues changes. |
| ha.control-defaults | Standard vacuum page; opt-in advanced controls/config defaults | Installed options/entity preservation; Safari plan/default readback; native tests | Live new-install dashboard and upgraded saved automation behavior. |
| camera.png | PNG camera responses, including resized images | Both installed camera endpoints returned PNG; assets matched | Current consumer/card display and failure/dimension boundaries. |
| assist.mcp | Admin Assist/MCP read and write tools | Seven installed read tools; direct Run; owner-confirmed mic input and spoken reply | Remaining Room/Stop/reset tool routes and refusals; model-selected physical writes. |
| firmware.comparison-notifications | Firmware research and optional notification blueprints | Native tracker-to-saved-blueprint retry tests; live Check again/Acknowledge traces, native ACK receipt and owner-confirmed clearing | Test pushes do not establish an actual firmware-transition alert or automatic update. |
| pair.reset-identity | Reset recovery rechecks robot identity | Native failure/no-write/identity tests; installed credentials preserved | Real robot reset/re-pair identity, reconnect and plan/area preservation. |
| pair.import-helper | Experimental pairing import without local Bluetooth | Native adapter/import gate tests | Actual helper and robot pairing on supported host(s), with identity confirmation. |
| upgrade.ha-version | Home Assistant 2026.10 minimum | Installed Core 2026.10.4; Python 3.14 CI; HACS/Hassfest | Do not extend this evidence to an untested future Home Assistant release. |
| upgrade.rollback-backup | Matching-backup rollback after store migration | Encrypted backup verified; rollback guidance and migration tests | Isolated restore/rollback drill preserving newer runs. |
| upgrade.storage11to12 | Minor-11→12 timing-tier migration | 5,485 suite includes real storage manager/persist/cold-load composition; installed migration preserved existing data | Interrupted migration, restart/retry and matching-backup restore. |
| upgrade.entity.binary-cleaning | Replace duplicate cleaning binary sensor | Native entity tests; installed entity records preserved | Live dashboard/automation references after upgrade. |
| upgrade.entity.update-available | Replace duplicate update sensor with update entity | Native firmware/entity tests; installed preservation | Live update-entity state and old references; do not initiate firmware install for this check. |
| upgrade.entity.software-version | Move software version to device page | Native entity tests; installed version readback | Live device-page state and old references under unavailable/stale data. |
| upgrade.entity.hardware-revision | Move hardware revision to device page | Native entity tests | Confirm current device-page value and old references. |
| upgrade.existing-entity-choices | Preserve old entity enablement; hide duplicates on new installs | Installed entity/configuration preservation; native tests | New-entry default visibility and full existing/new migration matrix. |
| upgrade.english-localization | English strings; pseudo-language/RTL layout support | String parity and synthetic RTL/expanded-text tests | Refresh affected layouts after the gesture-help change; English is the shipped catalog. |
| deferred.contextual-history | Dedicated Cleaning History deferred to 0.6 | Current run outcomes and saved-map history tested | No 0.5 completion check; keep this deferral clear in product claims. |

## Acceptance still open

The live checks above do not certify every physical setting combination,
including one-time/skip and recovery runs, all robot fault cases, real
pairing/import hardware, complete device and assistive-technology coverage,
endurance, or a full backup restore. The 117-cell walkthrough is autonomous
inspection, not a set of owner cell approvals. Final owner acceptance remains
separate; stable merge and publication stay held until the owner gives fresh
explicit approval.

The owner has no spare robot or Windows/NVDA target. Those hardware checks stay
open. An isolated HAOS restore target is being prepared after the owner agreed
to a restore drill; the live server has not been restored. A fresh encrypted local
backup includes the current minor-12 store, all 185 recorded room completions,
and the updated firmware blueprint/configuration.
