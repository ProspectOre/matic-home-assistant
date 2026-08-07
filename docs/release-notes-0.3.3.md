# Release notes — 0.3.3

Released: 2026-08-07

## Summary

0.3.3 makes saved custom cleaning areas resilient to unrelated map redraws.
Each newly confirmed area records a private signature of only the union of
mapped geometry near its painted marks, allowing harmless changes elsewhere on
the floor—even between separated marks—to revalidate automatically.

## Safer map revalidation

- Unrelated room-boundary changes and sub-centimeter decoder jitter no longer
  invalidate every custom area on the floor; a 10 mm selection guard band also
  prevents jitter at the edge of the local geometry margin from changing the
  evidence set prematurely.
- Coverage mission, partition and nearby geometry changes still fail closed
  before any robot command is sent.
- A same-mission area with valid saved coordinates can be reviewed and rebound
  with **Confirm on current map** without repainting it.
- Areas whose coordinates are invalid or outside the current floor still
  require a redraw; the integration never guesses a coordinate transform.
- An exactly current legacy v1 or hash-only v2 area binding upgrades during
  integration startup or as soon as a temporarily unavailable map returns,
  preserving areas that were already cleared before this update.
- The Repair now directs administrators to the Custom areas workspace and
  reports only the affected count, never saved geometry.

This release changes no robot protocol commands and sends no map data outside
Home Assistant.

## Verification

The release candidate passes 904 Python tests / 8,476 statements at 100%
coverage, 42 Chromium browser tests, three iPhone WebKit interaction tests,
strict typing, lint and format checks, and the public-tree privacy gate.

## Upgrading from 0.3.2

Install 0.3.3 through HACS and restart Home Assistant. Existing entries, plans,
custom areas, automations, map history and cleaning history are preserved.
Current legacy custom-area bindings upgrade automatically; re-pairing is not
required.
