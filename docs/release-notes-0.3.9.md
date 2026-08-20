# Release notes — 0.3.9

Released: 2026-08-20

## Summary

0.3.9 sends a stopped robot home immediately. Stopping a clean — from the
vacuum entity, the stop-plan action, a presence automation, or a managed
plan's own cleanup — previously left the robot parked where it stopped for
firmware's full ten-minute graceful countdown before it returned. It now docks
as soon as the stopped task settles.

## Prompt return after a stop

- An accepted OEM STOP still owns the end of the task: a DOCK sent while the
  task is running is reinterpreted by firmware as recharge-and-resume, so that
  ordering is unchanged.
- A lifecycle-bound watcher then follows the stop and issues DOCK the moment
  the task actually settles. Measured on firmware v172.12, stop-to-docked drops
  from 11 minutes 30 seconds to 56 seconds.
- Docking is withheld unless every condition holds: the robot is idle, its own
  session reports no active cleaning task, and that stop still owns the robot.
  A replacement clean, a return already under way, a robot that never reports a
  settled task, or an unreadable session all leave firmware's countdown in
  charge exactly as before, and a rejected DOCK is logged without disturbing
  it.
- The watcher is tied to the config entry, so unloading or reloading Home
  Assistant cancels it, and the existing stop fence still blocks replacement
  work while a countdown is genuinely settling.

This release adds no robot protocol commands — DOCK is the same vetted command
the dock button already sends — and keeps all robot traffic, cleaning history,
maps, and reconciliation data local to Home Assistant.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff check and format, strict MyPy, the public-tree privacy gate, browser
tests, HACS validation, and Hassfest. The timing above was measured on a live
robot: stop at 12:59:23, settled at 13:00:13, DOCK issued, returning at
13:00:39, docked at 13:01:09, with no recharge-and-resume afterwards.

## Upgrading from 0.3.8

Install 0.3.9 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved. Stops now dock promptly; no configuration changes are
required.

Presence automations that stop cleaning only when an integration-managed plan
is active are worth reviewing: if a managed run ends early — for example after
a robot error — firmware can resume the task on its own, and a stop conditioned
on the managed plan will not stop that native run. Conditioning on the vacuum
state instead (`cleaning`, `paused`, or `idle`) and calling
`vacuum.return_to_base` covers both cases.
