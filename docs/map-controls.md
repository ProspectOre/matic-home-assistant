# Matic Map controls

[Cleaning and maps](cleaning.md) · [Entities](entities.md#maps)

Choose the floor beside **Matic Map**. In homes with multiple robots, choose
the robot there too. Select **3D**
for the photographic map or **2D** for **Photo** or **Room colors**. **Follow**
centers the live robot. **Ride along** turns with its heading.

The row below the view controls shows **Wi-Fi**, **Trail**, **Vacuum**, **Mop**,
**Carpet**, **Vents** and **Room names**. Click a room in either view to select
it in the cleaning panel. **Tools** opens map detail, zoom presets, a 100–1000% zoom field and diagnostics.
On a phone, Home Assistant navigation is also available there.

Drag to move, scroll to zoom, and right-drag or Shift-drag to turn the 3D view.
On a touch screen, drag with one finger to move, pinch to zoom, twist two
fingers to rotate, or drag two fingers together to tilt. Lift your fingers to
start a different gesture. **Fit map** recenters the floor. While drawing,
find it beside **Photo** and **Room colors**. The **?** in the toolbar lists
mouse, touch and keyboard controls,
including drawing shortcuts. **Full map** hides the cleaning panel and keeps
the toolbar, status and main action available.

Matic Map requires a Home Assistant administrator. For a dashboard, add
`camera.matic_map` with a Picture Entity card.

**Map history** lists saved maps by date. A saved map is read-only and shows no
robot position; with three or more, a slider runs from **Oldest** to **Live**.
**Mapped floors** appears when another floor is mapped, and **Show live map**
returns to your current floor.
