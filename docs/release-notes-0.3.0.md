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
  streams open and acknowledges every server sequence so emitted map pages and
  later refinements advance into the private cache. Streams are explicitly
  cancelled at unload, and a closed collector cannot reconnect during restart.
  A settled/balanced health signal is not proof that every physical surface was
  scanned.
- The renderer transposes the robot's channel-major floor tensor into map space
  before compositing pages. Neighboring live edges are continuous, eliminating
  the repeated 32-by-32 texture squares caused by flat raster reversal.
- Vectorized voxel projection and bounded PNG compression keep the Home
  Assistant event loop responsive while rendering the full map. Concurrent
  camera requests share one render, and ordinary live refinements replace the
  image without covering the existing map with a loading spinner.
- The admin-only **Matic Map** panel provides **3D**, orthographic
  **Top-down**, and labeled **Rooms** views. It supports orbit, pan, pinch,
  twist, tilt, fit, refresh, keyboard access, full-screen mode, loading/error
  feedback, room labels, and a live robot marker, with an automatic room-map
  fallback while SLAM pages are unavailable. Private requests use Home
  Assistant's authenticated frontend transport with its automatic token
  refresh, so a long-lived studio cannot fall back after a session expires.
  Room images are sized to the display (up to 2048 pixels) and coalesced while
  rendering so periodic updates cannot cancel and restart the same expensive
  image request.
- The photographic camera is disabled by default. Scene and pose endpoints
  require an administrator and use `private, no-store` responses. In-memory
  encoded scenes are purged on unload and removal. No cloud, analytics,
  telemetry, or third-party map service is involved.
- Map cache health, revision, truncation, layer/drop/invalid counts, stream
  state, and failures are surfaced without exposing map content. A limit-driven
  eviction forces `map_complete` false; balanced/settled pages do not prove
  every surface was scanned. The viewer refreshes a bounded complete scene
  after relevant changes; a guaranteed last-scanned timestamp, point-cloud
  deltas, and historical timelines are not part of 0.3.
- Removing the config entry also removes its private accumulated tile store.
- Legacy mixed-mission cache repair retains a usable photographic layer instead
  of allowing a mismatched structural page to erase the 3D scene.

## Named custom-area actions

- `matic_robot.clean_area` accepts a saved area name plus optional cleaning-mode
  and coverage overrides.
- Each area is bound to the coverage mission, standard partition, and canonical
  room geometry used by its editor. Legacy/unbound areas and any mismatch are
  blocked before a robot command; a privacy-safe Repair reports only the count
  affected and requires redraw on the current live map. There is no automatic
  coordinate transform or cross-floor migration.
- Automations never need raw coordinates. Saved geometry remains out of entity
  state, events, diagnostics, service-call data, and logs.
- The local command encoder is backed by byte-for-byte synthetic fixtures and
  rejects malformed or oversized geometry before transport.

## Plan and command safety

- A room is credited only after the issued one-room command is observed cleaning
  that target and a new robot-native history record confirms a successful,
  overlapping single-room run with a positive room duration. The active-session
  key disappearing means only that the task ended; it is never completion proof.
  App/robot STOP, stale or malformed history, duplicate room-name ambiguity, and
  takeover activity cannot advance last-cleaned, successful durations, run
  counts, or intelligent rotation.
- Low-charge return is suspended for automatic resume. Ordinary return while a
  firmware session is still active uses a neutral verification state, so it
  does not inflate pause/recharge counts. Cancelled and unverified elapsed time
  is stored separately and never overwrites the last successful duration.
- Per-robot arbitration serializes Home Assistant motion commands. A new clean,
  custom-area clean, stop, or dock revokes a managed plan generation before
  dispatch; pause/resume preserves it. Commands from another client remain an
  external takeover that Home Assistant can detect only through later state.

## Verification posture

The unpublished local candidate passed 678 tests / 6,579 statements at 100%
coverage, 10 real-browser UI tests, strict typing, lint/format, privacy,
wheel/source parity, and clean-wheel import. Live Home Assistant/Safari proof
covered maximum-detail 3D, exact pose, orbit, top-down, labeled Rooms, forced
refresh, repeated updates, expired-session recovery, and a second clean restart
with no Matic task leak, authentication failure, or traceback. No push, PR,
tag, or release was made.
