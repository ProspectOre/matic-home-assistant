# Final 0.5 candidate acceptance

Reconciled October 8, 2026, Pacific time. This receipt separates source
qualification from installed, device, physical and owner acceptance.

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

Local validation: 4,291 Python tests pass at 100% production coverage; Ruff,
formatting, strict mypy (64 source files), privacy and whitespace checks pass.
The 171 focused setting/entity/coordinator cases pass. Every affected setter
has synthetic timeout, cancellation and reconnect success/failure cases asserting
one write. Wheel and sdist match the integration source; fresh-wheel import passes.
Python 3.14.8 and HA 2026.9.3 were used, with `dbus-fast` explicitly installed for
the macOS test environment. Hosted Browser, HACS and Hassfest remain unrun for
this follow-up. No frontend assets changed.

The follow-up prepares `v0.5.0-rc12` metadata and is not yet a published or
installed RC. Its complete comparison
still requires regular exact-head review, Test/Browser/Validate and manual merge
under [the maintenance checklist](maintenance-reviews.md).

[PR #138](https://github.com/ProspectOre/matic-home-assistant/pull/138) merged as
`156ae4bf7f0203436bb73301153ef44bc2b707da` on October 4 Pacific time. Its former
merge hold is retired. The owner has retired the request coordinator; do not
route new review requests through it. Authentic complete review, findings
dispositions and required CI remain mandatory. Historical evidence gaps remain
historical and do not supply runtime acceptance.

## Remaining acceptance matrix

| Gate | Current evidence and closing requirement |
|---|---|
| Exact installed candidate | Earlier local evidence describes RC2 plus a setting-readback backport, not installed RC3 or 0.5. Bind reviewed source, installed files and loaded runtime to one candidate; verify rollback, plans/settings, coherent map and pose. Exercise child lock, pet waste, voice, deep mop and water flow independently, including confirmation, timeout, cancellation and reconnect. Synthetic tests do not establish device behavior. |
| Reliability and safety | Qualify disconnect/reconnect, stale/wrong-floor data, administrator loss, unload/reload, multiple tabs, history/Area conflicts and renderer failures on the final build. Guards must prevent commands; recovery must avoid duplicate dispatch and credit. Keep live transport default-OFF until fault/fallback and resource qualification. |
| Actual devices and accessibility | Actual iPhone/iPad Safari and Android Chrome; touch, keyboard, VoiceOver/NVDA, switch access, native zoom, safe areas, RTL and recovery language. Emulation and earlier Safari receipts cover only their named flows. |
| Sustained performance | Measure final-build desktop/mobile responsiveness and frame rates, CPU, retained memory/GPU and traffic/reconnect budgets over long sessions and large maps. Earlier scoped lab results do not close this gate. |
| Reporter confirmation | Issue #218 remains open pending the reporter's successful five-room RC3 result. Issues #65, #139 and #198 remain open pending affected-device confirmation. |
| Physical and cadence | Bounded physical acceptance is authorized by the owner on October 8. Private/shared N=1/N=3 progression, per-mode completion credit, pause/restart/low-charge recovery, guarded failure, Stop settlement and docking remain pending. Do not infer these results from source tests or Activity rows. Preserve schedules. |
| Product and publication | Independent whole-product review of the exact final candidate, owner walkthrough/signoff and separate stable-publication authorization remain required. |

A read-only administrator operations check on October 8 reported coordinator
available, docked, native session inactive, runner unlocked and no pending Stop
settlement. It did not inspect installed bytes, loaded module identity, preserved
storage, rollback or map readiness. No setting write, restart, installation,
cleaning command or cadence edit was issued for this reconciliation.

Private identifiers, maps, storage and raw device receipts must stay private.
The [acceptance matrix](acceptance-0.5.md) owns the wider contract; this receipt
records the final consolidation and its remaining proof obligations.
