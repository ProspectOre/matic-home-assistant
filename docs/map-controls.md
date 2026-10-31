# Matic Map controls

[Cleaning and maps](cleaning.md) · [Entities](entities.md#maps)

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
