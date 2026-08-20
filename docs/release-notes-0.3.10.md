# Release notes — 0.3.10

Released: 2026-08-20

## Summary

0.3.10 corrects what the robot's own cleaning record is allowed to prove. That
record cannot establish that a room was finished, so it no longer produces
completions — it now keeps rotation fairness current instead. This fixes rooms
being marked cleaned after the robot was stopped in them, and it lets cleaning
the integration did not manage inform the rotation for the first time.

## The robot's record proves activity, not completion

Firmware cleans without Home Assistant in ordinary situations: it resumes its
own task after an error, and the vendor app can start one. Earlier versions
imported the robot's per-room record as a verified completion at startup.

Live observation on firmware v172.12 shows that reading was wrong:

- a room the robot entered sixty seconds before being stopped, and a room it
  cleaned for thirty-one minutes, are recorded identically;
- a clean stopped after forty-five seconds still reported its room as
  completed, and reported the session as completed too.

The result was a room that received one minute of cleaning being recorded as
cleaned — taking its **last cleaned** timestamp, a duration, and a place at the
back of the intelligent rotation, so it would be skipped for a full cycle.

From 0.3.10 the robot's record is imported as a cleaning **opportunity**:

- rooms the robot has just worked in stop monopolising short runs, which is the
  same fairness rule already applied to a room whose managed run was
  interrupted;
- **last cleaned**, per-room durations, and completion counts continue to come
  only from runs whose end was verified, so an unverified room stays due;
- the import now also runs whenever a cleaning session finishes rather than
  only at startup, so unmanaged cleaning is reflected while it is still
  relevant. The listener is bound to the config entry, and an unreadable robot
  is logged and skipped.

Nothing about verified completion changed: managed plans still credit a room
only against a native record that matches the commanded room with a positive
duration.

This release adds no robot protocol commands and keeps all robot traffic,
cleaning history, maps, and reconciliation data local to Home Assistant.

## Room statistics need the same proof

The per-room **last cleaned** and **clean duration** sensors trusted the same
robot-reported session, including a fallback that accepted every room in a
session the robot called completed. A clean stopped after a minute therefore
recorded that room as cleaned. They now report only verified managed runs and
otherwise keep their last trusted value.

## An unreadable version is not an update

Firmware analysis compared version readings directly, so a version the robot
could not report counted as a change - once when the reading was lost and again
when it returned. A brief connection interruption produced two firmware-change
events, and any automation listening for them announced an update that never
happened. A release change is now reported only when both readings are known,
and an unreadable protocol version no longer requests a fresh snapshot.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff check and format, strict MyPy, the public-tree privacy gate, browser
tests, HACS validation, and Hassfest.

## Upgrading from 0.3.9

Install 0.3.10 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved.

A room that an earlier version credited from the robot's record keeps that
recorded timestamp; the value cannot be distinguished after the fact from a
verified completion, so it is left alone rather than guessed at. It is
corrected the next time that room is genuinely cleaned and verified.
