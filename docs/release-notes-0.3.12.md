# Release notes — 0.3.12

## Summary

0.3.12 hardens service access and keeps robot data within safe limits.

## What changed

- Commands now check Home Assistant permissions before they run.
- Saved plans, discovery, telemetry, messages, maps, and snapshots have size
  and time limits.
- Room matching is bounded and predictable.
- Invalid or oversized robot data is rejected safely.
- 3D SLAM scenes and 2D room overlays now require the same verified floor
  mission. During a physical floor move, dependent overlays and coordinate
  editing pause until both feeds agree instead of combining different floors.
- Private map history is grouped by floor. Map Studio shows a floor selector
  only when relevant; retained floors are ordinal-labeled, read-only, and never
  issue a robot command.

No robot protocol commands changed. Existing credentials, plans, maps, and
cleaning history stay local to Home Assistant.

Map checkpoints created by an older release do not contain a provable floor
identity. They remain bounded in private storage but are not offered as live or
saved-floor fallbacks; new classified checkpoints appear after the current 3D
map and floor plan agree.

## Verification

The release candidate must pass the full Python suite with 100% coverage,
Ruff, strict MyPy, the privacy check, browser tests, HACS, Hassfest, and
release-archive checks. Test it with the live robot before publishing.

## Upgrading

Install 0.3.12 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved.
