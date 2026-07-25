# Release notes — 0.3.0

Status: local release candidate — not published

## Summary

0.3.0 adds a private, local 3D SLAM map workspace and precise reusable custom
cleaning areas. It keeps the map, accumulated tiles, and drawn geometry inside
Home Assistant while exposing saved areas to automations by name.

## Full-screen custom-area studio

- **Configure → Custom cleaning areas** opens a viewport-sized editor instead
  of putting the map inside a scrolling form field.
- Every mapped room is labeled and can be focused directly. Draw and Pan are
  separate tools; the mouse wheel zooms around the cursor, middle-button or
  Space-drag pans temporarily, and pointer capture is released after every
  completed or cancelled gesture.
- Undo, Redo, and Clear mutate the existing editor without rebuilding it or
  escaping into Home Assistant's form. Clear is recoverable through Undo.
- Keyboard controls include Command/Control-Z, Shift-Command/Control-Z, D, P,
  plus, minus, 0 to fit, and Escape/Done editing to return to the name, mode,
  coverage, and Submit fields.
- Both the browser and server reject circle centers outside mapped rooms.
  Circle counts, radius, numeric bounds, and command payload size are bounded.

## Private 3D SLAM map

- A new photorealistic camera decodes the robot's local color SLAM tiles and
  integrated structural pages, accumulates both layers by the current
  firmware's signed page coordinates, and persists them in a size-bounded
  private Home Assistant store.
- A lifecycle-managed tracked Hermes subscription keeps both bidirectional
  streams open and acknowledges every server sequence so the complete map and
  later refinements advance into the private cache.
- The renderer transposes the robot's channel-major floor tensor into map space
  before compositing pages. Neighboring live edges are continuous, eliminating
  the repeated 32-by-32 texture squares caused by flat raster reversal.
- Vectorized voxel projection and bounded PNG compression keep the Home
  Assistant event loop responsive while rendering the full map. Concurrent
  camera requests share one render, and ordinary live refinements replace the
  image without covering the existing map with a loading spinner.
- The admin-only **Matic Map** panel provides a one-screen Photo/Rooms toggle,
  smooth bounded pan and zoom, fit, refresh, double-click zoom, arrow-key pan,
  full-screen mode, loading/error feedback, room labels, and an exact live robot
  marker, with an automatic labeled-room fallback while SLAM tiles are not
  available.
- Map images are served through Home Assistant's authenticated camera proxy.
  No cloud, analytics, telemetry, or third-party map service is involved.
- Removing the config entry also removes its private accumulated tile store.

## Named custom-area actions

- `matic_robot.clean_area` accepts a saved area name plus optional cleaning-mode
  and coverage overrides.
- Automations never need raw coordinates. Saved geometry remains out of entity
  state, events, diagnostics, service-call data, and logs.
- The local command encoder is backed by byte-for-byte synthetic fixtures and
  rejects malformed or oversized geometry before transport.

## Verification posture

The local candidate is gated by the complete test suite at 100% coverage,
JavaScript syntax validation, strict typing, lint and format checks, privacy
inspection, and release-artifact validation. Real Home Assistant/Safari proof
is performed privately before this candidate is considered publishable.
