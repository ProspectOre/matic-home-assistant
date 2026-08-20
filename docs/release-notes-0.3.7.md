# Release notes — 0.3.7

Released: 2026-08-19

## Summary

0.3.7 restores seamless room-to-room transitions in managed cleaning plans.
The robot pivots directly to the next room during its return instead of
docking and idling between rooms, while every 0.3.5 stop-safety and
verification guarantee stays in place.

## Eager room handoffs

- When a managed run observes a commanded room's normal return, it sends the
  next room immediately so the robot can pivot without docking. The finished
  room is verified against native history while the next room runs.
- An unverified room stops the eagerly started next room and receives no
  history credit, and that stop hands firmware ownership of the graceful
  return that follows.
- No next room is prepared while an OEM stop countdown is settling, a
  cancellation is in progress, or a finish-current-room stop request is
  active. The sequential verify-then-dispatch path remains the fallback
  whenever the eager dispatch is unavailable, including a retry after
  verification so a cleared stop fence or a transient dispatch error does not
  end the run early.
- Rotation invariants are unchanged: history credit still requires the strict
  native single-room completion record, and unverified, failed, cancelled, or
  interrupted rooms stay uncredited while keeping their fairness ordering.

This release adds no robot protocol commands and keeps all robot traffic,
cleaning history, maps, and reconciliation data local to Home Assistant.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff check and format, strict MyPy, the public-tree privacy gate, browser
tests, HACS validation, and Hassfest.

## Upgrading from 0.3.6

Install 0.3.7 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved. Multi-room plan runs no longer dock between rooms;
stop behavior and history rules are unchanged.
