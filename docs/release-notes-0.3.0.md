# Release notes — 0.3.0

Status: local release candidate — not published

## Summary

0.3.0 adds a private local 3D SLAM workspace and reusable cleaning areas. Maps, accumulated tiles, and geometry remain in Home Assistant; automations use names.

## Unified Cleaning workspace

- **Matic Map → Cleaning** opens a viewport-sized workspace with **Plans** and
  **Custom areas** views for creating, editing, running, and deleting definitions.
  Configure remains a compatibility entry point.
- The map exposes both views as first-class actions. Native room checkboxes use
  full switch-sized hit targets and preserve saved settings reliably in Safari.
- Photo, Rooms, and repaired boundary overlays share one coordinate
  viewport, staying aligned across 2D, 3D, and navigation. A cache-busted module
  supports Home Assistant sessions opened before integration startup.
- Every mapped room is labeled and can be focused directly. Paint, Erase, and
  Move are separate tools. Dragging paints continuously; wheel input zooms at the
  cursor; middle-button or Space-drag pans. Pointer capture always releases.
- Undo, Redo, and Clear mutate the existing editor without rebuilding it or
  escaping into Home Assistant's form. Clear is recoverable through Undo, and
  pointer guards preserve native Safari/WebKit button activation.
- Keyboard controls include undo/redo, D/E/P, plus, minus, 0 to fit, and
  Escape/Done editing to return to the name, mode, coverage, and Submit fields.
- Both the browser and server reject circle centers outside mapped rooms.
  Circle counts, radius, numeric bounds, and command payload size are bounded.

## Private 3D SLAM map

- A photorealistic camera decodes local color SLAM tiles and structural pages,
  accumulating signed page coordinates in a bounded private Home Assistant store.
- A lifecycle-managed tracked Hermes subscription keeps both bidirectional
  streams open and acknowledges each server sequence. Streams cancel at unload;
  closed collectors cannot reconnect during restart. Settled/balanced health
  does not prove every physical surface was scanned.
- The renderer transposes the robot's channel-major floor tensor into map space
  before compositing. Continuous edges remove repeated 32-by-32 texture squares.
- Vectorized voxel projection and bounded PNG compression keep the Home
  Assistant event loop responsive while rendering the full map. Concurrent
  camera requests share one render, and ordinary live refinements replace the
  image without covering the existing map with a loading spinner.
- The admin-only **Matic Map** panel provides **3D** and **2D** views; 2D switches
  between photographic and labeled room maps. Orbit, pan, pinch, twist, tilt,
  wheel/trackpad navigation, fit, refresh, keyboard control, full screen, status,
  labels, and live pose share a compact native toolbar. 2D stays planar and keeps
  independent framing; non-square room maps remain centered.
  Mouse movement stops on release, camera targets stay bounded, and Fit map
  reliably recenters the house. A failed refresh retains the last
  good 3D scene; the room map remains the initial-load fallback while SLAM pages
  are unavailable. Startup and active collection serve coherent scene snapshots
  instead of repeatedly conflicting, then advance automatically on later polls.
  Concurrent viewers share the newest completed encode even when the map changes,
  and queued requests stop before encoding after an entry unloads.
  WebGL loss now keeps the local camera map visible through background refreshes,
  then restores the retained 3D scene without downloading it again.
  Multiple robots keep independent scene, pose, ETag, and camera-fallback state;
  late responses from a previously selected entry are discarded.
  Unloading the final entry also clears retained map buffers and references from
  the browser instead of leaving the last private scene resident.
  Catalog, scene, pose, and camera requests are time-bounded. Stalled refreshes
  retain the last map; a stalled first load exits with recovery guidance. Private
  requests use Home Assistant transport and automatic token refresh.
  Room images are sized to the display (up to 2048 pixels) and coalesced so
  periodic updates cannot restart the same expensive render. Map controls stop
  gesture propagation without cancelling native button focus or click synthesis.
- The zoom slider uses the same camera bounds as gestures, exposing and
  representing every reachable zoom level.
- The photographic camera is disabled by default. Scene and pose endpoints
  require an administrator and use `private, no-store` responses. In-memory
  encoded scenes are purged on unload and removal. No cloud, analytics,
  telemetry, or third-party map service is involved.
- Map cache health, revision, truncation, layer/drop/invalid counts, stream
  state, and failures are surfaced without exposing map content. A limit-driven
  eviction forces `map_complete` false; balanced/settled pages do not prove
  every surface was scanned. The viewer starts with a bounded complete scene,
  then applies compressed binary deltas through an authenticated long-poll.
  Missing or inefficient bases fall back to a complete scene in that request.
- Mission rollover no longer replaces the usable workspace with the first sparse
  page pair. Live keeps the last complete scene, overlays the current robot pose,
  suppresses incompatible deltas, then switches when the new scene is complete.
- Stable scenes enter a private timeline capped at 12 checkpoints and 48 MiB;
  **History · Live** opens its upward scrubber or a clear empty state. Removing the entry clears tiles
  and history; no guaranteed last-scanned timestamp is exposed.
- Legacy mixed-mission cache repair retains a usable photographic layer instead
  of allowing a mismatched structural page to erase the 3D scene.

## Named custom-area actions

- `matic_robot.clean_area` accepts a saved area name plus optional mode and coverage overrides.
- Native **Custom cleaning area** and **Clean selected area** entities expose
  saved areas on the device page without publishing geometry.
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

- Intelligent rotation ranks target-room-confirmed cleaning starts across plans;
  saved order breaks ties, rejected commands and lingering prior-room state do not
  move a room. Unfinished starts rotate without credit; completion requires the
  one-room command plus a new overlapping native single-room record, positive
  duration, and verified completed status for a requested mode. The global
  protobuf default and active-session disappearance are not completion evidence.
  STOP, unknown/non-completed mode status, stale or malformed history, duplicate
  room-name ambiguity, and takeover cannot advance last-cleaned, successful
  durations, or run counts. Stable room IDs take precedence over colliding
  display names throughout plan persistence, editing, and command dispatch.
- Verified completions immediately notify room statistics and persist duration.
  Startup recovers the newest retained record with explicit room completion and
  positive duration; defaults, attempts, cancellations, failures, and unverified records remain ineligible.
- Finish-current-room estimates reuse bounded successful durations across plans
  only for the same robot, stable room ID, cleaning mode, and coverage. Aggregate
  duration history from earlier releases requires at least three successful runs;
  mismatched or malformed history remains unusable.
- Low-charge return is suspended for automatic resume. Ordinary return while a
  firmware session is still active uses a neutral verification state, so it
  does not inflate pause/recharge counts. Cancelled and unverified elapsed time
  is stored separately and never overwrites the last successful duration.
- Per-robot arbitration serializes Home Assistant motion commands. A new clean,
  custom-area clean, stop, or dock revokes a managed plan generation before
  dispatch; pause/resume preserves it. Commands from another client remain an
  external takeover that Home Assistant can detect only through later state.

## Protocol foundations

- Firmware compatibility snapshots are keyed by software and protocol. Staged
  post-reboot metadata schedules a follow-up snapshot instead of leaving
  compatibility pending.
- Tracked snapshots acknowledge sequence IDs and enforce record, duration, and
  byte limits, so history and semantic pages cannot stop after one record.
- Bounded client decoders validate session images, monthly recaps, semantic grids,
  the live route, and native 3D flythrough. Retained captures prove 20 images, one
  recap, two 781-page layers, 444 route messages, and 1,606 flythrough poses.
- These client-only foundations add no private content to entity state, Recorder,
  diagnostics, map storage, media endpoints, or browser responses in 0.3.0.

## Verification posture

The unpublished candidate passes 865 Python tests / 8,011 statements at 100% coverage, 38 browser tests, strict typing, lint/format, privacy, exact-tree Hassfest, artifact parity, and clean-wheel import. The official HACS action passes all nine repository checks against the published default branch; validating this unpushed revision through HACS requires a remote ref. Live Safari covered the map lifecycle. Real-robot runs covered both coverage levels, all three cleaning modes, a two-room no-dock handoff, both intelligent-stop branches, and persisted custom-area cleaning with fail-closed credit. HAOS reauthentication was also exercised through credential revocation, stale-bond removal, passkey expiry/rejection recovery, fresh bonding, credential verification, and a clean Core restart. Post-passkey progress now follows the terminal pairing task directly, and BlueZ agent cleanup is bounded so successful setup cannot remain behind an indefinite progress dialog. Live Container Bluetooth proof and publishing remain open.
