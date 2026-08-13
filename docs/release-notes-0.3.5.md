# Release notes — 0.3.5

Released: 2026-08-13

## Summary

0.3.5 makes interrupted saved-plan runs safer around Matic's native graceful
STOP countdown. It prevents a replacement clean from racing that countdown,
reconciles a late verified native completion without guessing, and improves
the reliability of the local Map Studio after an integration reload.

## Safer managed-plan stops and handoffs

- A STOP sent for an active task now owns Matic's graceful return. The
  integration does not immediately send a second DOCK command that firmware
  can interpret as recharge-and-resume.
- While the native stop countdown is settling, new full-floor, room, custom
  area, and saved-plan commands wait until Matic reports a stable `docked`,
  `charging`, or `idle` state. This prevents duplicate or replacement work
  during the countdown. Every accepted STOP saves its absolute fence deadline,
  so a Home Assistant restart restores only the original window's remaining
  protection.
- If Matic publishes one new, matching native single-room completion within
  the fixed reconciliation window, the integration safely reconciles its room
  history and duration. Expired markers are cleared so a later OEM clean
  cannot be credited to an old failed plan; ambiguous, malformed, or unrelated
  session records also remain uncredited. A live watcher that reaches the end
  of that window now durably removes its pending marker as well.
- Late reconciliation tasks are tied to the integration lifecycle and are
  cancelled when a newer motion command replaces the run or the config entry
  unloads. Marker removal is saved before replacement motion begins, and a
  superseded cleanup cannot recreate or reschedule that marker. Resetting
  affected plan history also cancels and removes any matching late-completion
  reconciliation so old activity cannot recreate that history.
- A room-to-room handoff waits for verified completion before preparing the
  next room, avoiding a queued follow-on command when a native stop or return
  is still settling.

## Presence and Map Studio reliability

- The **Clean when everyone leaves** blueprint starts only if Matic is
  `docked` or `idle`. A person leaving while a manual or other existing clean
  is underway no longer replaces it; returning home still stops only an
  integration-managed saved plan.
- Map Studio registers a fresh panel element after an in-place integration
  reload, gives its current and compatibility tags distinct browser
  constructors, rebinds its essential view and cleaning controls safely, and
  falls back to the dialog `open` attribute on embedded browser surfaces that
  lack the native dialog methods.

This release adds no robot protocol commands and keeps all robot traffic,
cleaning history, maps, and reconciliation data local to Home Assistant.

## Verification

The release candidate passes 949 Python tests / 8,972 statements at 100%
coverage, 43 Chromium browser tests, three iPhone WebKit interaction tests,
strict typing, lint and format checks, the public-tree privacy gate, release
archive inspection, and a fresh-install import check.

## Upgrading from 0.3.4

Install 0.3.5 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, map history, and cleaning history are
preserved. After stopping an active clean, wait for Matic to dock before
starting another cleaning command.
