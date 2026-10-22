# 0.5.0

Map Studio becomes the one place to see your home, choose what to clean and
check what happened. This release carries every 0.5 release-candidate change
through RC37.

## What's new

- **Map Studio is the workspace.** One map in 2D, 3D or Photo, with room
  colors and room names on every view. The Classic view and its switch are
  gone; Home Assistant's own configuration forms stay as they were.
- **Custom areas in plans.** A saved plan can mix rooms and drawn areas, in
  order. Each area leg is tracked by its own cleaning session, and Stop
  during an area settles cleanly.
- **Home shortcuts.** Pin a plan or an area to the top of the map and start it
  with one tap.
- **Saved areas stay valid after cleaning.** Routine map refinement after a
  run, an integration reload or a Home Assistant restart no longer asks you to
  confirm or redraw a saved area.
- **Every room keeps its name.** Labels draw after all room fills, and a label
  that would cover another moves to the nearest free spot instead of
  disappearing.
- **Honest robot position.** The robot marker shows only while its position is
  current, and the map says when it is locating.
- **Map history.** Browse earlier floor maps, read-only and dated.
- **Stop is always reachable** while the robot is connected, even when the map
  is still loading.

## Known limitations

- Live map streaming ships off by default; the map refreshes through the
  existing update path.
- Some phone and tablet layouts and assistive-technology checks are still
  being qualified; see the [acceptance matrix](acceptance-0.5.md).

## Update

Install through HACS and restart Home Assistant while the robot is docked.
Home Assistant **2026.10+** is required. Existing plans, areas, shortcuts and
credentials are preserved. Installed RC37 results, including a supervised
custom-area run, are recorded in the
[continuity qualification](verification-0.5-area-continuity.md).
[Installation](../README.md#install) · [Compatibility](acceptance-0.5.md).
