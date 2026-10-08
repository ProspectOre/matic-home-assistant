# Final 0.5 candidate acceptance

Reconciled October 8, 2026, Pacific time; source, installed, device, physical and owner gates remain separate.

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
[PR #231](https://github.com/ProspectOre/matic-home-assistant/pull/231) merged as
`892185d304ee7fa5cd6dedcb7b78ada37be75047`, after clean regular review of
`d74d761a05174d0d739b9d728acc01ffeb0303cb` and green hosted checks.
RC12's HACS install matched 92 files; rollback, preservation, new startup,
diagnostics/compiled caches, map/live pose, visible Safari and all five live
setter change/restore confirmations passed. Every setter also has synthetic
timeout, cancellation and reconnect cases asserting one write; live fault
qualification remains open. Earlier-head results do not qualify later changes.

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
Focused regressions reproduce both mechanisms and cover newer fences,
replacement runs and unload. Temporary plans were removed after settlement,
preserving definitions, selection, saved Areas and automation enablement. RC13
passed 4,297 Python tests at 100% coverage and all source checks.

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
deadline; RC16 addresses this separately.

[PR #236](https://github.com/ProspectOre/matic-home-assistant/pull/236) merged as
`bdb52e0db654d54174b3330efd1f974b4eb4f0fa` after clean regular review of
`8f47997504bbfadc9a95a3daf35988052a8b5876` and green hosted Test/Browser/HACS/Hassfest.
The real grpclib wrapper reproduced transport-error replacement of cancellation;
retired floor/Cues watchers now finish before backoff, while active clients retry.
All 4,346 Python tests pass at 100% coverage; Browser passed 1,050/one skip.
Wheel/sdist match all 92 source files byte-for-byte; fresh-wheel import passes.
RC16 is installed through HACS, with matching files, verified rollback,
preservation, new startup/version diagnostics, source-matching compiled caches,
native idle state, map/live pose and visible desktop Safari recovery.
All five setters passed live change/restore confirmation, restoring every value.
Idle reload preserved settings/plans/last-run state; its observer recorded one
new-runtime session-identification write, no retired-runtime writes and no
motion/settings. The cancellation warning was absent in that reload window.
Compiled-cache matching is not an in-process code-hash measurement.

Actual Android Chrome's earlier ten-minute/298-gesture 150% zoom stress
measured p95 152 ms; a 124-second/60-gesture 100% comparison measured 144 ms.
RC15's 122-second/61-gesture default-zoom repeat measured 160 ms, as did three
detailed repeats. The 2D comparison measured 168 ms. Handlers were short and
delay after processing remained in both modes; no GPU cause or version regression
is proved. RC16's final 122-second/61-gesture run measured 152 ms, with four
assets matching reviewed bytes and no page errors. These scopes all miss the
100 ms project budget. Whole-page heap/Chrome PSS and RAF/short traces do not
qualify component/GPU retention, sustained presented FPS or field INP.

[PR #138](https://github.com/ProspectOre/matic-home-assistant/pull/138) merged as
`156ae4bf7f0203436bb73301153ef44bc2b707da` on October 4 Pacific time. Its former
merge hold and the owner-retired request coordinator are retired. Use direct
regular review; complete review, findings dispositions and required CI remain
mandatory. Historical evidence gaps do not supply runtime acceptance.

## Remaining acceptance matrix

| Gate | Current evidence and closing requirement |
|---|---|
| Exact installed candidate | RC16 files/version, startup, diagnostics/compiled caches, rollback, preservation, map/pose, five live confirmations and idle reload passed; its cancellation warning was absent. Direct in-process code-hash proof remains open. RC13 bounded failure settlement passed. Live timeout, cancellation and reconnect remain unqualified for every setter. |
| Reliability and safety | Qualify disconnect/reconnect, stale/wrong-floor data, administrator loss, unload/reload, multiple tabs, history/Area conflicts and renderer failures on the final build. Guards must prevent commands; recovery must avoid duplicate dispatch and credit. Keep live transport default-OFF until fault/fallback and resource qualification. |
| Actual devices and accessibility | Actual iPhone/iPad Safari and Android Chrome; touch, keyboard, VoiceOver/NVDA, switch access, native zoom, safe areas, RTL and recovery language. Actual Android Chrome rendered 2D/3D, accepted generated touch navigation and reflowed at native 150% zoom. This limited flow does not qualify every device or assistive technology. |
| Sustained performance | Measure final-build desktop/mobile responsiveness and frame rates, CPU, retained memory/GPU and traffic/reconnect budgets over long sessions and large maps. RC12 synthetic desktop endurance completed 10 minutes/403 scene changes, no console errors, stable node/listener counts, post-GC heap 3.0–4.1 MB. RAF sampling is not GPU-presented FPS; this does not close mobile/GPU/live-traffic or longer-session qualification. |
| Reporter confirmation | Issue #218 remains open pending the reporter's successful five-room RC3 result. Issues #65, #139 and #198 remain open pending affected-device confirmation. |
| Physical and cadence | Bounded physical acceptance is authorized by the owner on October 8. Private/shared N=1/N=3 progression, per-mode completion credit, pause/restart/low-charge recovery, guarded failure, Stop settlement and docking remain pending. Do not infer these results from source tests or Activity rows. Preserve schedules. |
| Product and publication | Independent whole-product review of the exact final candidate, owner walkthrough/signoff remain required. The owner authorized stable publication after completed qualification. |

Keep identifiers, maps, storage and raw device receipts private. The
[acceptance matrix](acceptance-0.5.md) owns the wider contract.
