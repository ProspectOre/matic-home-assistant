# 0.3.0

Released: 2026-07-29

- Adds the **Matic Map** workspace with local 3D and 2D views, room overlays, navigation controls, and saved map history.
- Adds a photographic SLAM camera, disabled by default, alongside the labeled room-map camera.
- Combines plan editing and custom-area drawing in the cleaning workspace.
- Saves named custom areas for reuse through `matic_robot.clean_area`, a selector, or a button. Areas are checked against their saved map before running.
- Improves rotation fairness, shared room-duration estimates, pause/recharge handling, and coordination between Home Assistant commands.
- Improves reauthentication and map recovery after reloads or map changes.

Existing credentials, plans, and room history are retained. Review custom areas
when prompted after a map change.
