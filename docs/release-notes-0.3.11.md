# Release notes — 0.3.11

Released: 2026-08-20

## Summary

0.3.11 closes the last place where a stopped room could still be recorded as
cleaned: a managed run that ends where the robot stood.

## Ending in place is a stop, not a finished room

The robot reports a room it was stopped in exactly the way it reports a room it
cleaned to the end, so the robot's record cannot tell them apart. Home
Assistant can: a finished task returns to its dock, while a stopped one ends in
place.

- A managed room or leg whose task ends in place is now recorded as
  interrupted. It receives no completion, no duration, and stays due.
- A task that returns, or that reaches the dock, is unchanged and still
  verifies its rooms against the robot's record before crediting them.
- Late native reconciliation is never scheduled for a task that ended in
  place. Reconciliation exists for runs Home Assistant lost sight of; here it
  watched the room stop, so a marker could only ever re-credit the room that
  stop disproved.

This matters when a clean is stopped outside Home Assistant — from the vendor
app, for example — while a managed plan is running. Before this release the
plan verified the stopped room against the robot's record, the record claimed
completion, and the room was credited and pushed to the back of the rotation.

This release adds no robot protocol commands and keeps all robot traffic,
cleaning history, maps, and reconciliation data local to Home Assistant.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff check and format, strict MyPy, the public-tree privacy gate, browser
tests, HACS validation, and Hassfest.

## Upgrading from 0.3.10

Install 0.3.11 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved.
