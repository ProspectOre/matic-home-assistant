# Release notes — 0.2.3

Released: 2026-07-23

## Summary

0.2.3 keeps multi-room plans moving without an unwanted dock visit between
rooms and makes interrupted-run history truthful. It also makes plan stopping
idempotent and keeps the active-session indicator aligned with the robot's
current operational state.

## Reliable multi-room plans

- A completed room is recognized as soon as the robot begins returning, even
  on firmware that reports Cleaning and Returning simultaneously.
- The next room is dispatched during that return phase, so the robot does not
  reach the dock between rooms. It docks only after the last planned room.
- A five-second operational refresh runs only while a managed room is active,
  making the handoff responsive without increasing normal background polling.
- Repeating a stop action after a plan has already ended is harmless.

## Accurate stopping and room history

- Immediate stop and return-to-base exclude the interrupted current room from
  completed-room statistics.
- Brief mapped-room transit under 60 seconds no longer credits that room as
  cleaned.
- Managed plan outcomes are the source of truth for room timestamps and
  durations. A cancelled room is not credited, while older legitimate room
  completions remain visible.
- Small timing differences between plan dispatch and operational detection no
  longer hide a legitimately completed first room.
- Active cleaning session now follows Cleaning, Paused, and Returning state,
  so it clears after docking even if stale native session telemetry remains.

## Live verification

A two-room plan was exercised on a real robot. The second room started during
the first room's return without an intermediate dock visit. Stopping in the
second room recorded it as cancelled, preserved earlier completed-room results,
and left both Active cleaning session and Problem off at the dock.

## Upgrading from 0.2.2

Install 0.2.3 through HACS and restart Home Assistant. No re-pairing, entity-ID
migration, or plan recreation is required. Existing plans and room history are
preserved.
