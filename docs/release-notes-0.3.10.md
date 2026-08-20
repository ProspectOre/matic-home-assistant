# Release notes — 0.3.10

Released: 2026-08-20

## Summary

0.3.10 keeps room history in step with the robot. Firmware cleans without Home
Assistant in ordinary situations — it resumes its own task after an error, and
the vendor app can start one — and until now those rooms kept reading as due
until the next Home Assistant restart, which also pushed them to the front of
the intelligent rotation.

## Room history follows the robot

- Every time a cleaning session finishes, the integration imports the robot's
  own per-room completion evidence, instead of doing that only at startup.
- The evidence standard is unchanged: a room is credited only when the robot's
  record marks it completed with a positive duration. Interrupted, stopped, and
  unfinished rooms stay due, and a record that is missing, ambiguous, or
  unreadable credits nothing.
- This covers the case observed live on 2026-08-20: a managed plan ended early
  on a robot error at 11:59, firmware resumed the same task on its own at 12:07
  and cleaned four rooms over the next 32 minutes, and none of that work was
  reflected in room history or rotation order.
- The listener is bound to the config entry, so unloading Home Assistant
  removes it, and a robot that cannot be read is logged and skipped.

This release adds no robot protocol commands and keeps all robot traffic,
cleaning history, maps, and reconciliation data local to Home Assistant.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff check and format, strict MyPy, the public-tree privacy gate, browser
tests, HACS validation, and Hassfest.

## Upgrading from 0.3.9

Install 0.3.10 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved. The restart also imports any retained robot-side
completions that earlier versions missed, so rotation order may shift once to
reflect cleaning the robot had already done.
