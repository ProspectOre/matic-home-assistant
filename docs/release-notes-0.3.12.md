# 0.3.12

- Adds permission checks for commands and bounds plans, discovery, telemetry, messages, maps, and snapshots.
- Keeps map layers, room geometry, pose, and saved history aligned to the same floor.
- Improves map recovery and read-only browsing of saved floors.

Older map checkpoints without a floor identity remain stored but are not shown
in map history. New checkpoints appear once map layers agree on the floor.
