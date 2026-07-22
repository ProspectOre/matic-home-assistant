# Release notes — 0.2.2

Released: 2026-07-21

## Summary

0.2.2 hardens long-running local connections, fixes cleaning history on
firmware that leaves its native history stale, and restores exact robot map
position across both verified pose layouts. It also prevents one-poll firmware
error pulses from creating misleading Activity and Problem entries.

## Connection reliability

- A robot-initiated HTTP/2 rollover no longer makes every entity unavailable.
  The integration closes the stale pinned channel, performs a fresh verified
  connection and handshake, and retries the idempotent state read once.
- Concurrent reads reuse a channel another task has already replaced instead
  of closing that fresh connection.
- TLS identity validation and certificate pinning remain mandatory on every
  replacement channel.

## Activity and fault semantics

- Raw Hermes error integers are exposed truthfully as `error_code_<raw>`;
  values are no longer indexed into the app's unrelated enum ordering.
- A code must be present for two consecutive 30-second polls before Activity
  changes to Error or the Problem entity turns on. Brief self-clearing firmware
  pulses remain available in debug logs without spamming Logbook.
- Persistent errors still surface with their exact raw code.

## Cleaning history and room statistics

- When the robot's native coverage-session collection is stale, the integration
  reconstructs the newest run from Home Assistant's verified Cleaning and
  Current area history.
- Active runs survive an integration or Home Assistant restart through Recorder
  recovery.
- Firmware phrases such as `the Living Room` are normalized to mapped room
  names, and brief unavailable gaps do not split a run.
- Last run duration, per-room duration, per-room last cleaned, session
  attributes, and the cleaning-finished event now use the newest native or
  locally reconstructed session.

## Map position

- `latest_pose` supports the original `2 → 1 → 1` translation path and the
  live-verified v168 `5 → 1` path.
- Exact in-bounds pose is shown while the robot is on the mapped floor. If the
  dock is outside the room polygons or pose is unavailable, an amber room-level
  marker is used instead of hiding the robot or claiming false precision.
- Payload-free endpoint inspection reports only candidate vector field paths;
  it never returns coordinates or raw home-context payloads.

## Upgrading from 0.2.1

Install 0.2.2 through HACS and restart Home Assistant. No re-pairing, entity-ID
migration, or plan recreation is required. Existing restored room statistics
and saved plans are preserved.
