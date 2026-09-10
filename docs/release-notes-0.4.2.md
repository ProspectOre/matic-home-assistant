# 0.4.2

- Keeps saved maps visible while the robot rechecks its current floor. If live data is unavailable, Map Studio shows a dated local snapshot in read-only mode.
- Prevents repeated stale map updates from toggling cleaning buttons and creating misleading **Pressed** entries in Home Assistant activity.
- Keeps robot position hidden and cleaning controls disabled until the live map is verified. Live controls return automatically after recovery.
- Preserves the previous map while a replacement loads, without carrying old cleaning selections onto a different floor.

Update through HACS and restart Home Assistant while the robot is docked.
Existing plans, areas, and credentials are preserved.
