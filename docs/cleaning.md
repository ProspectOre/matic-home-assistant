# Cleaning and maps

[Documentation](README.md) · [Automations](automation.md)

Open **Matic Map** in the Home Assistant sidebar to plan, clean and browse maps.

## Saved plans

Choose **Your plans** on the home screen, then **Create a plan**. A plan saves
its rooms and custom areas in order, each with a cleaning mode and vacuum
coverage; its **Cleaning order** (**Smart Order** or **Saved order**); and,
under **When a run ends**, **Smart Stop** and **Return to the dock when
finished**.

<a id="run-and-edit"></a>
The **Run** view previews the next run: its order, each room's settings and any
work that's due. Use **Plan enabled** to pause or resume the plan; choose **Run
plan** to start. **Show on home** adds the plan to the home screen as a
[shortcut](#home-shortcuts). In **Edit**, tick rooms, open a room for its
settings and schedule, add saved areas under **Custom areas**, and in **Saved
order** use the arrows in **Rooms and custom areas** to reorder. **Save** keeps
changes, **Cancel** asks before discarding them, and **More actions > Delete**
removes the plan.

A plan defines what to clean; Home Assistant automations decide when it runs.
**Matic settings** (Settings > Devices & services > Matic (Unofficial) >
Configure) sets the default plan and resets room cleaning history. Rooms can
also have [room schedules](room-schedules.md) for mopping or deeper vacuuming.

<a id="how-a-plan-runs"></a>
### How a plan runs

A plan runs in one or more parts, and the Run view says when there are several:

- Rooms next to each other in the order run as one part. The robot goes from
  room to room without returning to the dock, and each room keeps its own
  settings. It may still stop at the dock on its own to recharge or refill.
- Each custom area is a part of its own. After an area, the robot heads back
  to the dock, and the next room or area usually starts from there.
- With **Smart Stop** on, each room is also a part of its own, so pressing Stop
  never lets the next room begin.

So "Kitchen, Rug, Hall" runs in three parts, usually with two dock trips, while
"Kitchen, Hall, Rug" runs in two. To keep dock trips down, put custom areas at
the start or end of a plan. Each room and area gets its own result, and **Plan
finished** fires once, after the last part. After a Home Assistant restart the
plan continues with the next part ([restart recovery](restart-recovery.md)).

<a id="intelligent-rotation"></a>
### Smart Order

Smart Order starts with the rooms and custom areas that have waited longest;
saved order breaks ties. Anything that starts moves behind what's still waiting,
even if cleaning later stops, and cleans started in the Matic app count too.
**Last cleaned** and cleaning times update only for confirmed work ([how results
are counted](native-cleaning-results.md)). **Saved order** runs top to bottom,
as listed, every time.

<a id="occupied-rooms"></a>
### Occupied rooms

With **Hold occupied rooms** on, a plan leaves out any room whose occupancy or
presence sensor is on when the run starts. The sensors are the `binary_sensor`
entities with the **Occupancy** or **Presence** class in the Home Assistant
area the room is assigned to (the same area **Clean area** uses). A plan can
name one sensor for a room instead with `occupancy_sensors`.

A held room is not cleaned, gets no result and keeps its place, so under Smart
Order it is first in line for the next run. The Run view lists held rooms and
the sensor holding each one, and each held room fires **Room held**. A sensor
that is off, unknown or unavailable never holds a room. Occupancy is read once
when the run starts; a room that becomes occupied later is still cleaned. If
every room is held and the plan has no custom areas, the run does not start.

### Stopping a plan

Stop ends cleaning and returns the robot to the dock. With **Smart Stop** on,
the plan uses its progress threshold:

- Below the threshold: stop now.
- At or above it: finish the current room, then dock without starting another.
- Custom areas, and rooms with no learned time yet, finish first. Use **0%**
  to always finish the current room.

While a room finishes, **Stop now & dock** stops right away. Progress is a time
estimate from earlier cleans with the same settings, not measured floor area.
Pause and resume keep the plan; a separate clean, Stop or Dock replaces it.

<a id="map-studio"></a>

## Matic Map

Choose **3D** for the photographic map or **2D** for a top-down view, which can
show the photo or room colors. With a mouse, drag to move, scroll to zoom, and
right-drag or Shift-drag to turn the 3D view. On a touch screen, drag with one
finger to move, pinch to zoom, twist two fingers to rotate, and drag two fingers
up or down together to tilt the 3D view. A two-finger gesture keeps doing what
it started until you lift your fingers. **Map zoom** takes 100 to 1000% or a
preset, and **Fit map** recenters the floor. The **?** on the map lists the
mouse, touch or keyboard controls for the input you're using, plus the drawing
controls while you draw. **Full map** hides the panel and keeps the status, the
main action and **Exit full map** in a small bar over the map. **Map options**
holds map detail and diagnostics; on a phone it also holds the 2D appearance
and room names. Click a room on either view to select it; the map and room list
stay in sync. The map panel requires a Home Assistant administrator; for a
dashboard, add `camera.matic_map` with a Picture Entity card.

**Map history** lists saved maps by date. A saved map is read-only and shows no
robot position; with three or more, a slider runs from **Oldest** to **Live**.
**Mapped floors** appears when another floor is mapped, and **Show live map**
returns to your current floor.

## One-time cleaning

Choose **Clean rooms**, then tick rooms on the map or in the list. **Cleaning
settings** picks vacuum, mop or both, and the vacuum coverage for the whole
clean; **Settings for {room}** changes one room. Vacuum coverage is **Quick**,
**Optimal** or **Heavy duty** and doesn't change mopping; use the robot's
**Double-pass mopping** setting for an extra mop pass. When a room's schedule
has work due, **Use room schedules** is on and the clean includes it; turn it
off to use only your settings ([room schedules](room-schedules.md#one-time-room-cleans)).
The line above the button lists the rooms in order, then "back to the dock",
and says when the clean needs more than one part. Use the cleaning controls to
pause, resume or stop.

Home Assistant Areas map to rooms by exact name or unique alias; set other
matches in the vacuum entity's cleaning-area settings. Room names must be unique.

## Custom areas

**Clean custom area** opens **Your areas**, the areas saved on this floor;
choose **New area** to draw one.

1. Pick a tool: **Points** places corners, **Paint** and **Erase** brush the
   map (**Brush** sets the width), and **Move map** pans without drawing.
   **Undo**, **Redo** and **Clear** sit in the same row; **Cancel** leaves the
   map as it was.
2. Choose **Name and save**, give the area a name, cleaning mode and coverage,
   and choose **Save area**.
3. Choose the area in **Your areas** to clean it, change its settings, redraw
   it, or delete it with **Delete** at the end of its details. **Show on
   home** adds it to the home screen as a shortcut.

Areas may cross room boundaries. Add one to a plan under **Custom areas** in
the plan's **Edit** view (a plan holds up to 100), pick it from the robot's
**Custom cleaning area** entity, or call it by name in an
[automation](automation.md#custom-areas). Each area cleans as its own part, and
the robot usually returns to the dock when the area is done
([how a plan runs](#how-a-plan-runs)).

Map updates away from an area don't need it saved again. If the map near an
area changes, its row says **Map changed · Check it before cleaning** and the
area opens as **Check {name}**. Choose **Confirm area on current map** to keep
the outline, or **Redraw**; neither starts a clean. An area the map can't place
any more says **Redraw it before cleaning**. Coordinates stay in Home
Assistant; automations need only the saved name.

## Home shortcuts

New plans and custom areas appear under **Shortcuts** by default. Turn **Show
on home** off on a saved item's screen to hide it. **Edit shortcuts**, at the
end of the **Shortcuts** heading, moves items up or down; choose **Done editing
shortcuts** when finished. Choices and order are saved per Home Assistant user
and robot. A shortcut runs exactly as **Run plan** or **Clean this area**
would, says why when it can't, and shows **Stop** while it runs.
