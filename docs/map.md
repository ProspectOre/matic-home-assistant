# Matic Map

[Cleaning and plans](cleaning.md) · [Entities](entities.md#maps) · [Privacy](privacy.md#map-access)

Matic Map is the sidebar page for the robot's map. It needs a Home Assistant
administrator; for a dashboard anyone can see, add `camera.matic_map` to a
Picture Entity card.

## Move around

Choose **3D** for the photographic map or **2D** for a top-down view, which
can show the photo or room colors. Room colors never give two neighbouring
rooms the same color, and the colors stay apart for the common kinds of color
blindness; rooms that don't touch can share one, so the names tell them apart.

| Input | Move | Zoom | Turn or tilt |
| --- | --- | --- | --- |
| Mouse | Drag | Scroll | Right-drag or Shift-drag turns the 3D view |
| Touch | Drag with one finger | Pinch | Twist two fingers to turn; drag two fingers up or down to tilt |

A two-finger gesture keeps doing what it started until you lift your fingers.
**Map zoom** takes 100 to 1000% or a preset, and **Fit map** recenters the
floor. The **?** on the map lists the mouse, touch or keyboard controls for the
input you're using, plus the drawing controls while you draw. Click a room on
either view to select it; the map and the room list stay in step.

**Full map** hides the panel and keeps the status, the main action and **Exit
full map** in a small bar over the map.

## Map options

The **Layers** button at the top of the page opens Map options, which holds
what the map shows. On a phone it also holds the 2D appearance and room names.
**Robot trail**, **Wi-Fi signal** and **Carpet and vents** are also one tap
away under **Fit map** on the live map.

This browser remembers which of those three layers you left on for each
robot, and turns them back on when you open the map again or switch back to
that robot. A robot you haven't changed them for starts with all three off.
The choices stay in this browser; another browser or device keeps its own.

The **Map key** on the map names what the carpet, vent, zone and trail
outlines mean, for whichever of them the map is showing.

## Details

On the live map, tap or click the robot, a trail point, a zone or a room for a
details card; with the map focused, **Enter** shows what is in its middle.
The card's actions match what the robot is doing:

- **Robot**: its status, the same **Stop** or **Resume cleaning** as the panel,
  and **Follow the robot**.
- **Room**: its size, whether the robot is in it, carpet or vent under your tap
  while **Carpet and vents** is on, and **Choose for a clean** while a clean
  can start.
- **Zone**: its kind, size and the rooms it lies in.
- **Trail point**: when the robot was there, by the robot's own clock, how far
  into the clean that was, and **Earlier point** and **Later point** to step
  along the path, which a ring marks. Arrows along the trail point the way the
  robot went. Trails recorded by an earlier version have no times. The
  robot doesn't report its cleaning mode with its position, so the trail can't
  show vacuuming and mopping apart.

- **Follow the robot** keeps the live robot centered; moving the map yourself
  turns it off. **Ride along in 3D** also turns the view with the robot. Both
  need a live position, and Ride along needs the robot's heading. Neither shows
  video from the robot's camera.
- **Wi-Fi signal** estimates the signal up to 1.5 m (5 ft) from each reading,
  within the reading's own room, in four bands: strong (-55 dBm and up), good
  (-67 to -56), weak (-80 to -68) and dead zone (below -80), which is also
  outlined. Areas with few or old readings are fainter; blank areas are
  unmeasured. The legend on the map names the weakest room and lists every
  room; tap or click a spot to read its estimate, how many readings it rests
  on and how old they are. Turn on the robot's **Wi-Fi survey** switch first:
  the robot then scans every 30 seconds while it's away from the dock.
  **Clear Wi-Fi survey** starts over, for example after you move your router.
- **Carpet and vents** outlines the rugs and floor vents the robot has found,
  carpet in brown and vents in blue.

No-go zones set in the Matic app always show, read only. A custom area that
overlaps one says so, and the robot skips that part.

## Cleaning history

**Cleaning history** lists recent cleans, newest first, with each room and
custom area marked done, partly done, stopped or not started, and how the
clean ended. Cleans started in the Matic app or by a robot schedule are listed
too. Open a clean to see the robot's own map picture of it, for the recent
cleans the robot still keeps, and choose **Show trail on map** to draw the path
the robot took. The path is sampled, so it can have gaps.

## Saved maps

**Map history** lists saved maps by date. A saved map shows one floor, is read
only and never shows where the robot is now. With three or more, a slider runs
from **Oldest** to **Live**. **Mapped floors** appears when another floor is
mapped, and **Show live map** returns to your current floor.

**Maps & storage** manages those saved maps:

- Home Assistant saves maps on its own and replaces the oldest when it needs
  room. **Keep** protects one from replacement; **Pause automatic history**
  stops new ones.
- A robot holds up to 12 saved maps and 48 MiB of compressed map data across
  all its floors, counting kept and recently deleted maps.
- Deleting moves a map to **Recently deleted**, where **Restore** works for 24
  hours. It still counts against storage until you delete it permanently.
- **Export** downloads an archive of the maps you select. It contains your
  home's layout and imagery, so store it as carefully as a backup. **Import an
  archive** accepts a file of up to 68 MiB; imported maps are for viewing only.
- **Compare selected** shows two saved maps side by side. When the two line up,
  it counts the map cells seen in both as **Changed** or **Unchanged**; every
  other cell is **Unknown** and may have changed.

None of this changes the robot's own map, your plans, custom areas, cleaning
history or photos. Deleting a floor or resetting the robot's map stays in the
Matic app.
