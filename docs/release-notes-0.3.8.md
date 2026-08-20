# Release notes — 0.3.8

Released: 2026-08-19

## Summary

0.3.8 restores true no-dock transitions inside managed cleaning plans. Since
robot firmware v172 queues any command received during a return and executes
it only after docking, per-room dispatch could no longer glide between rooms.
Managed runs now group consecutive same-settings rooms into one native
multi-room mission, so the robot moves room to room exactly the way its own
full-floor cleans do.

## Mission legs

- After rotation ordering, consecutive rooms sharing one cleaning mode and
  coverage form a leg and are dispatched as a single ordered native mission.
  The robot glides between the leg's rooms without touching the dock; a
  settings change starts the next leg at the observed return.
- Room history still advances per room and only from native evidence: the
  leg's single history record must mark each room completed with a positive
  per-room duration. Partial legs credit exactly their verified subset, and
  unverified, stopped, or skipped rooms stay due with their fairness ordering.
- Live per-room tracking follows the robot's reported current area, so
  room-started events, the active-plan sensor, and finish-current-room
  progress estimation keep working inside a leg.
- A finish-current-room stop inside a leg sends the managed STOP at the
  observed room boundary, honoring the threshold policy without letting the
  mission roll into later rooms. Immediate stops, low-charge recharge-resume
  suspensions, cancellation, unload, and OEM stop-fence handling keep their
  existing semantics.
- An unverified leg stops any eagerly prepared next leg without credit, and
  no next leg is prepared while a native stop countdown settles.

This release adds no robot protocol commands — multi-room ordered missions
use the same verified command as `matic_robot.clean` — and keeps all robot
traffic, cleaning history, maps, and reconciliation data local to Home
Assistant.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff check and format, strict MyPy, the public-tree privacy gate, browser
tests, HACS validation, and Hassfest.

## Upgrading from 0.3.7

Install 0.3.8 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved. Plans whose rooms share one mode and coverage now
run as a single glide; plans with mixed per-room settings dock briefly only
between settings groups.
