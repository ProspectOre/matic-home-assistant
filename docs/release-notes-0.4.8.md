# 0.4.8 hotfix

Fix mixed vacuum/mop plans that aborted while confirming coverage settings.
Native mop encoding, double-pass normalization and fresh readback transitions
now agree. Binary, deep-mop and water-flow changes wait for a matching fresh
robot value; a missing confirmation raises a translated Home Assistant error.
A broken read channel gets one reconnect and read retry, without repeating
the setting command.

## Acceptance evidence

The [issue #218 reporter](https://github.com/ProspectOre/matic-home-assistant/issues/218#issuecomment-6073803413)
reported on October 8, 2026 as `axsuul`: “Confirming v0.4.8-rc2 fixes this for us.”
The receipt identifies loaded 0.4.8rc2 and HA 2026.8.0.
GitHub issue-comment ID `6073803413` is independently retrievable through
`GET /repos/ProspectOre/matic-home-assistant/issues/comments/6073803413`.
The Heavy/double-pass run completed all five rooms with verified credit,
resumed after two recharges and finished docked without integration warnings
or errors. The Standard run reached room five before an external app Stop;
it earned zero credit and does not establish a natural finish or Stop cleanup.

The owner accepted this report and waived another reporter RC3 five-room run.
The setting-confirmation changes passed regular review and required CI in
PR #228; RC3 metadata passed in PR #229. A local 0.4 RC2-based backport
confirmed deep-mop on/off without motion. RC3 itself was not installed locally.

This final package changes RC3 version metadata to 0.4.8; runtime code is
unchanged. Final-package installed validation remains a publication gate.

## Compatibility

This hotfix is for the 0.4 line and excludes the separate maintenance firmware
features and 0.5 Map Studio/cadence qualification. Do not downgrade a 0.5
installation: its saved-plan storage is incompatible. Existing plans and
automations should be preserved during a supported 0.4 upgrade.
