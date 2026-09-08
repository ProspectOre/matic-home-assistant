# Cleaning and maps

[Documentation](README.md) · [Automations](automation.md)

## Map Studio

Open **Matic Map** from Home Assistant's sidebar. Choose **3D** for the photographic
map or **2D** for a top-down view. The 2D appearance can show the photo or room map.

Drag to move around the map; use pinch or the wheel to zoom. **Fit map** recenters
the floor. **How to move the map** lists mouse, touch, and keyboard controls.
Map options include appearance, refresh, and full screen.

**Map history** browses saved views. When history includes another floor, the
floor selector can show it read-only. Cleaning is available only on the current
floor. After carrying the robot, wait for its new map and position to appear.

The map panel requires a Home Assistant administrator. For a dashboard, add
`camera.matic_map` with a Picture Entity card.

## One-time cleaning

Choose **One-time clean**, select rooms, and pick vacuum, mop, or both.
Coverage choices are **Quick**, **Optimal**, and **Heavy Duty**. Start the run
from its summary; use the active cleaning controls to pause, resume, or stop.

Home Assistant Areas can map to Matic rooms. Exact names and unique aliases
match automatically; configure other matches in the integration's options.
Mapped room names must be unique.

## Saved plans

Choose **Create a plan**, or open **Run a plan** to select an existing routine.
Each plan saves:

- Included rooms and their order.
- Cleaning mode and coverage for each room.
- Intelligent rotation or saved-order execution.
- Return-to-dock and finish-current-room preferences.

Drag rooms or use their arrow controls to reorder them. Matching settings let
consecutive rooms share one mission. A settings change starts another mission,
which can include a dock visit. Group similar settings when order allows it.

A plan defines what to clean. Home Assistant automations decide when it runs.
The integration's **Configure** flow also supports plan editing.

### Intelligent rotation

Rotation starts with the room that has waited longest for a cleaning opportunity;
saved order breaks ties. Rooms that actually start move behind waiting rooms,
even if cleaning later stops. Rejected commands do not change their priority.
Cleaning started in the Matic app also contributes to this ordering.

Completion history is separate: only confirmed completed work advances **Last
cleaned** and successful durations. [How results are counted](native-cleaning-results.md).

Choose **Saved order** in the plan editor to use that order every time.

### Stopping a plan

Stop normally ends cleaning and returns the robot to its dock. If **Finish the
current room when stopping** is enabled, the plan uses its progress threshold:

- Below the threshold: stop immediately.
- At or above it: finish the active room, then dock without starting another.
- No learned duration yet: finish the active room. Use **0%** to always finish it.

Progress is a time estimate from successful runs with matching room settings,
not a measured floor-area percentage. Pauses and recharge are excluded from
active cleaning time. Wait for the stop to settle before starting another run.

Pause/resume preserves the plan. A separate clean, Stop, or Dock replaces it.
Avoid controlling the robot from multiple integrations or apps at once.

## Custom areas

Choose **Clean a custom area** to create an area or select one already saved.

1. Place points around the part of the map to clean. The outline closes automatically.
2. Drag points to adjust the boundary; insert or delete points as needed.
3. Use undo/redo to correct edits, then save a name, cleaning mode, and coverage.
4. Reopen the area to edit it or run it again.

Areas may cross room boundaries. They remain saved for future runs and can be
selected from the robot's **Custom cleaning area** entity or called by name in
an [automation](automation.md#custom-areas).

If the map changes, a saved area may need **Confirm on current map** or a redraw.
The editor shows the required action. Coordinates stay in Home Assistant;
automations need only the saved name.
