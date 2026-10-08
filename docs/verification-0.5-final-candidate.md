# Final 0.5 candidate acceptance

Reconciled October 8, 2026, Pacific time. Source, installed, device, physical
and owner acceptance are separate gates.

## Composition and review

The integration base is `8ea47f0c431161bb661cf5ad6a742407d1145c37`, also tagged
`v0.5.0-rc11`. The follow-up ports the setting-confirmation implementation from
maintenance [PR #228](https://github.com/ProspectOre/matic-home-assistant/pull/228),
commit `88df0807ab09a6fad536e40ccc9c43ebe41992a5`, while preserving main's newer
transport and firmware-snapshot safeguards. RC3 metadata is not copied into 0.5.
Each write is sent once; fresh matching state is required within eight seconds.
A failed read reconnects once using the pinned channel, without resending the
write. Cancellation propagates. Unconfirmed writes surface a safe HA error.
The coordinator retains refresh demand raised during an existing poll.

Independent product review found an Area conflict: a catalog refresh after
another tab deleted the selected Area discarded unsaved edits. The repair
preserves the drawing/name/settings as a new dirty draft, detaches the missing
ID and warns that saving creates a new Area. Clean selections still reconcile;
targeted Chromium/WebKit regressions verify preservation and no stale deletion.
Shipped frontend assets are regenerated from the repaired source.
The initial port passed 4,291 Python tests at 100% coverage and all source
checks. Every setter has synthetic timeout, cancellation and reconnect
success/failure cases asserting one write; 171 focused cases passed. Wheel/sdist
parity and fresh-wheel import passed on Python 3.14.8/HA 2026.9.3. After the
Area repair, 38 focused packaging/privacy/frontend cases and four browser
regressions passed. Earlier-head results do not qualify later runtime changes.

[PR #231](https://github.com/ProspectOre/matic-home-assistant/pull/231) merged as
`892185d304ee7fa5cd6dedcb7b78ada37be75047` after a clean regular review of
`d74d761a05174d0d739b9d728acc01ffeb0303cb` and green Test, Browser, HACS and
Hassfest. Browser reported 1,038 passed and one capability skip. RC12 was
published as a pre-release and installed through HACS beta versions. Its 92
integration files matched the candidate; rollback and saved definitions,
selection, Areas and automation enablement were verified. The new HTTP
next-run preview is derived output, not a stored-plan change. A new HA startup,
source-matching compiled caches, diagnostics version, native state, coherent
map/live pose and visible Safari behavior provided separate recovery evidence.
All five setters passed live change/restore confirmation (10 cases); every
original setting was restored. Live timeout/cancel/reconnect remain unqualified.

RC12 physical qualification failed: the bounded one-room private N=1 run
missed its 120-second start deadline. Native history showed the room unvisited
and both modes unattempted. One Start, Stop and Dock were observed; physical
return completed, but software settlement waited on a Dock-watcher lease
needed by the timeout finalizer. No success or cadence credit is claimed. The
owner confirmed the target was closed off: this proves guarded failure only.

The RC13 follow-up releases the command lease before Dock confirmation, clears
only a failed run's captured Stop fence without upgrading outcome or credit,
and marks firmware startup replay as an event-loop callback. Live HA 2026.10
logs exposed an issue-registry thread-safety error in the old startup lambda.
Focused regressions reproduce both mechanisms. The temporary plan was removed
after verified settlement; original definitions, selection, saved Areas and
automation enablement were preserved. RC13 local validation passes 4,297 Python
tests with 100% production coverage, Ruff, formatting, strict mypy, packaging
and privacy checks. Tests also cover newer fences, replacement runs and unload
after the Dock lease is released.

[PR #232](https://github.com/ProspectOre/matic-home-assistant/pull/232) merged as
`5534960fd30aab7da4018031e3e1ca49f9d75f1b`, after clean regular review of
`1fc97e3f0bd73cee3ec3c6d33c0b10ab6392d77b` and green hosted checks.
RC13 was published as a pre-release and installed through HACS. All 92 files,
rollback copies and preserved settings/definitions matched. New startup,
diagnostics, source-matching caches, native runner, map/pose and visible Safari
recovery passed; the startup thread error was absent. All five setters again
passed live change/restore confirmation. The unavailable-target test dispatched
one Start, Stop and Dock, finalized failure about 1.9 seconds after Stop,
cleared its fence and returned to docked/idle with zero completion credit.
Temporary plans were removed with preservation receipts.

Whole-product source review then found allocation before telemetry field and
stored-base64 limits, duplicate canonical room identities, a queued Return-to-base
race and untrusted research text/URLs in diagnostic summaries. Remediation and
targeted regressions are consolidated for RC14: 4,333 local tests pass at
100% production coverage, with Ruff, formatting, strict mypy and privacy checks.
Firmware notifications retain structured identity/actions without research text.
[PR #233](https://github.com/ProspectOre/matic-home-assistant/pull/233) merged
as `78f0d9309fed44fe261bc45198f0cc1a510c60a4` after clean regular exact-head
review and green hosted Test, Browser, HACS and Hassfest. RC14 is installed
through HACS: all 92 files match, rollback/state preservation and new-startup
runtime diagnostics/caches, native idle state and map/pose guards pass.
All five live setters passed change/restore confirmation. Idle entry reload
preserved settings, plans, last-run evidence and HA uptime; an independent
Core observer recorded two session-identification writes, one from each
runtime, with no motion or setting commands in its reload window.
Startup has no Matic runtime error; HA warns that JSON tool results are
deprecated and require migration before HA 2027.11.

Performance-path review found lower renderer detail cropped the point-cloud
prefix, spending its budget on floors before surfaces. RC15 samples each
initialized floor/surface range with a shared stride, spreading samples across
both ranges without extra GPU allocation or changing delta bytes. Balanced
uses every second point; Efficient every third; Auto can adapt to every fourth.
Sparse features can still be missed: this removes prefix cropping, not a
universal spatial-coverage guarantee. Synthetic distant-region, attribute
alignment and partial-upload checks supplement renderer recovery regressions.
Lifecycle review also found a pending setting readback could reconnect its
client after unload. Successful unload now permanently retires that runtime;
normal close remains reusable for read recovery. Shutdown drains pending dials.
Retirement rejects new reads, reconnects and captured-channel requests,
and closes connections finishing late.
Deterministic readback and TLS-race regressions assert no reopened channel or
repeated write. [PR #234](https://github.com/ProspectOre/matic-home-assistant/pull/234)
merged as `016aa3de133fff1c42748dd3b9ef4ecbe78503b7` after clean regular review
of `935acbfec81c1d9f4539356a666f51810330f407` and green hosted checks:
4,341 Python tests at 100% coverage; 1,050 browser cases passed, one skipped.
RC15 is a HACS-installed pre-release: 92 files match, rollback/preservation,
new startup, diagnostics, source-matching compiled caches, map/pose and native
idle state pass. All five setters passed change/restore confirmation. Idle
reload preserved settings/plans/last-run state; the observer saw one new-runtime
session-identification write, no retired-runtime writes and no motion/settings.
HA nevertheless warned a floor-stream task exceeded its unload cancellation
deadline; lifecycle qualification remains open pending investigation.

Actual Android Chrome completed ten minutes and 298 generated map gestures at
native 150% zoom, with no page errors. Captured interaction-duration p95 was
152 ms, exceeding the 100 ms project budget in this stress scope. Whole-page
heap and Chrome-process PSS do not establish component or GPU retention.
A separate short diagnostic trace showed presentation gaps, but cannot qualify
sustained frame rates. A 124-second default-zoom comparison with 60 gestures
recorded p95 144 ms and no page errors, also missing the lab input proxy.
An RC15 default-zoom repeat lasted 122 seconds/61 gestures, with four RC15
assets matching reviewed bytes, no page errors and p95 160 ms. The budget remains unmet;
these short runs do not qualify sustained resources or GPU-presented FPS.

[PR #138](https://github.com/ProspectOre/matic-home-assistant/pull/138) merged as
`156ae4bf7f0203436bb73301153ef44bc2b707da` on October 4 Pacific time. Its former
merge hold is retired. The owner has retired the request coordinator; do not
route new review requests through it. Authentic complete review, findings
dispositions and required CI remain mandatory. Historical evidence gaps remain
historical and do not supply runtime acceptance.

## Remaining acceptance matrix

| Gate | Current evidence and closing requirement |
|---|---|
| Exact installed candidate | RC15 file identity, startup, diagnostics/compiled caches, rollback, preservation, map/pose, five live confirmations and idle reload state preservation passed. An unload task exceeded HA cancellation deadline; investigation remains open. RC13 bounded failure settlement passed. Live timeout, cancellation and reconnect remain unqualified for every setter. |
| Reliability and safety | Qualify disconnect/reconnect, stale/wrong-floor data, administrator loss, unload/reload, multiple tabs, history/Area conflicts and renderer failures on the final build. Guards must prevent commands; recovery must avoid duplicate dispatch and credit. Keep live transport default-OFF until fault/fallback and resource qualification. |
| Actual devices and accessibility | Actual iPhone/iPad Safari and Android Chrome; touch, keyboard, VoiceOver/NVDA, switch access, native zoom, safe areas, RTL and recovery language. Actual Android Chrome rendered 2D/3D, accepted generated touch navigation and reflowed at native 150% zoom. This limited flow does not qualify every device or assistive technology. |
| Sustained performance | Measure final-build desktop/mobile responsiveness and frame rates, CPU, retained memory/GPU and traffic/reconnect budgets over long sessions and large maps. RC12 synthetic desktop endurance completed 10 minutes/403 scene changes, no console errors, stable node/listener counts, post-GC heap 3.0–4.1 MB. RAF sampling is not GPU-presented FPS; this does not close mobile/GPU/live-traffic or longer-session qualification. |
| Reporter confirmation | Issue #218 remains open pending the reporter's successful five-room RC3 result. Issues #65, #139 and #198 remain open pending affected-device confirmation. |
| Physical and cadence | Bounded physical acceptance is authorized by the owner on October 8. Private/shared N=1/N=3 progression, per-mode completion credit, pause/restart/low-charge recovery, guarded failure, Stop settlement and docking remain pending. Do not infer these results from source tests or Activity rows. Preserve schedules. |
| Product and publication | Independent whole-product review of the exact final candidate, owner walkthrough/signoff remain required. The owner authorized stable publication after completed qualification. |

Keep identifiers, maps, storage and raw device receipts private. The
[acceptance matrix](acceptance-0.5.md) owns the wider contract.
