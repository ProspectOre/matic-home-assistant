# RC17 source qualification

October 10, 2026, Pacific time. The source candidate is
[PR #238](https://github.com/ProspectOre/matic-home-assistant/pull/238), based on
`f97ee2195ba5afd253a0dd8999048d4c45d1d0e9`. The installed-candidate record remains
[RC16](verification-0.5-final-candidate.md). Source checks do not establish a
new installation, device performance, physical cleaning or owner acceptance.

## Repairs

- Unknown or malformed localization revokes map authority. A completed poll
  rechecks the floor-read generation after all awaited work; it may retain only
  a published map that still matches current localization. Revoke/recover races
  cannot restore the earlier cached map. Eight deterministic cases cover cached
  reads, pending snapshot enrichment, malformed events and early recovery.
- Native mixed-cleaning admission rechecks stable idle state and ownership after
  checkpoint persistence, before the first command. Cancellation or replacement
  task evidence sends no start command.
- Managed-plan admission uses the same normalized room name as native completion
  matching. Aliases such as `Dining Room` and `The Dining Room` are rejected
  before any leg dispatch or prefetch. Eight regressions cover case, whitespace,
  native prefixes and an ambiguous later leg; seven fail the earlier source.
- Canvas2D fallback uses the same camera projection as annotations and room hits.
  It caches at most 1024 by 1024 pixels, projects at most 2,000 sampled points per
  timer turn with a four-millisecond yield target, and composites the cache on
  animation frames. Scene, camera or viewport changes invalidate the cache;
  hidden pages and disposal cancel work. The unchanged-view regression measured
  700,000 point paints before the repair versus 50,000 after it. This is a
  deterministic work count, not an installed-device latency measurement.
- Coarse-touch Auto detail bounds floor and surface point work. Unsupported
  workspace events preserve the panel; RTL arrow focus follows visual order;
  status and workspace landmarks use localization.
- Plan-picker theme checks now activate the real browser color scheme and
  assert surface luminance and text contrast at 320, 390, 820 and 1280 pixels.
  The earlier dark-labelled screenshots used an inert property and did not
  establish dark appearance.

## Qualification

The cached-floor regression failed the earlier source, then passed the repair.
All 4,368 Python tests pass at 100% statement coverage. Ruff, formatting, strict
Python types, TypeScript, public-tree privacy, frontend rebuild, wheel/sdist
file parity and fresh-wheel import pass locally. The macOS test environment
adds Home Assistant's pinned `dbus-fast==5.0.22` dependency, which its normal
Linux dependency selection supplies on hosted CI.

The full local browser pass completed 1,065 cases; two new WebKit raster cases
exposed an unfixed CSS size in the test fixture at higher pixel density. With
the fixture fixed to the product's CSS sizing, all 25 affected fallback and
plan-picker cases pass across Chromium, WebKit and Firefox safety coverage.
Native desktop Safari also exercised the synthetic plan picker, Unicode draft
editing, discard confirmation and Escape cancellation. Dark-theme screenshots
were visually checked at phone and desktop widths. These are synthetic UI
checks, not live Home Assistant or physical-device acceptance.

Regular review and hosted checks must cover the pushed candidate, including the
room-alias repair found during the wider executor audit. The earlier
review of `6cc423e87d40ef3af0d9430e1161647b4008345d`
reported the two repaired floor-publication and fallback-rendering findings;
its completion status was not a clean verdict.

## Remaining release gates

1. Clean complete regular review and required Test, Browser, HACS and Hassfest
   checks for the exact candidate; manual merge through the platform.
2. Publish RC17 as a prerelease, install through HACS with rollback and
   preservation receipts, then verify installed files, loaded runtime, map/pose,
   guarded failures, settings confirmations and unload/recovery.
3. Remeasure sustained Android input and resource budgets. RC16's 152 ms p95
   missed the 100 ms budget. Emulation does not qualify actual Apple devices,
   VoiceOver/NVDA, switch access or native zoom.
4. Complete bounded physical and private/shared N=1/N=3 cadence qualification
   on an accessible floor, including verified credit, interruption/recovery,
   Stop settlement, docking and cleanup. Preserve normal schedules.
5. Complete the owner walkthrough and acceptance before stable publication.

Live transport remains default-OFF. Issue #218 is closed with accepted RC2
five-room reporter proof and stable 0.4.8 publication; that separate hotfix
does not close these 0.5 gates. Full requirements remain in the
[acceptance matrix](acceptance-0.5.md).
