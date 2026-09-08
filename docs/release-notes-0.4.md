# 0.4.0

A redesigned Matic Map, new robot icons, and editable cleaning-area outlines.

## What's new

- **New icons and artwork.** A custom robot illustration for HACS and the integration, a matching Home Assistant sidebar icon, and refreshed map and cleaning controls.
- **Redesigned map workspace.** One-time cleaning, saved plans, and custom areas are easier to find. Map controls sit at the edges, leaving more room for the floor view.
- **Editable area outlines.** Place points around an area; the outline closes automatically. Drag, insert, or delete points, with undo and redo. Saved areas can be reopened and adjusted.
- **Better phone navigation.** Controls respect the companion app's safe areas, and plan selection, drawing, and returning to Home Assistant are clearer.

## Fixes

- Maps recover more reliably after a restart, refresh, or change of floor.
- Stop stays available while cleaning starts. Finish-current-room stopping keeps later rooms from starting.
- Plans track their original cleaning session through pause and recharge without adopting a separate task started in the Matic app.
- History separates vacuum and mop results and durations. Partial work affects rotation order without being marked fully cleaned.
- Pairing, reauthentication, saved-area recovery, and keyboard navigation are more reliable.

## Update

Install through HACS and restart Home Assistant while the robot is docked.
Home Assistant **2026.7+** is required. Existing plans, areas, and credentials
are preserved. [Installation](../README.md#install) · [Compatibility](acceptance-0.4.md).
