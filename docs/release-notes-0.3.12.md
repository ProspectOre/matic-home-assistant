# Release notes — 0.3.12

## Summary

0.3.12 hardens service access and keeps robot data within safe limits.

## What changed

- Commands now check Home Assistant permissions before they run.
- Saved plans, discovery, telemetry, messages, maps, and snapshots have size
  and time limits.
- Room matching is bounded and predictable.
- Invalid or oversized robot data is rejected safely.

No robot protocol commands changed. Existing credentials, plans, maps, and
cleaning history stay local to Home Assistant.

## Verification

The release candidate must pass the full Python suite with 100% coverage,
Ruff, strict MyPy, the privacy check, browser tests, HACS, Hassfest, and
release-archive checks. Test it with the live robot before publishing.

## Upgrading

Install 0.3.12 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved.
