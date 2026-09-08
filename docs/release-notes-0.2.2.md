# 0.2.2

Released: 2026-07-21

- Recovers local connections after robot-initiated HTTP/2 rollover.
- Filters brief firmware error pulses and preserves unknown error codes accurately.
- Reconstructs recent activity when native history is stale and restores active runs after a Home Assistant restart.
- Restores robot position on firmware using the newer pose layout, with a room-level fallback when exact position is unavailable.
