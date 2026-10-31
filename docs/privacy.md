# Privacy

[Documentation](README.md) · [Security](../SECURITY.md)

Routine control, maps, and state travel directly between Home Assistant and the
robot over an encrypted LAN connection. The integration has no telemetry,
analytics, or maintainer cloud service.

## Stored data

| Data | Where it lives |
| --- | --- |
| Local credential, endpoint, certificate identity, and the robot's Bluetooth address | Home Assistant config entry |
| Plans, room preferences, schedule progress, room duration history, results, custom-area geometry, and a running plan's restart checkpoint | Private integration storage |
| Wi-Fi survey readings | Private integration storage; mean signal per one-metre map cell, up to 4,096 cells on each of 8 floors. Network names are not stored |
| Current photographic map and saved map history | Private integration storage; the current map holds up to 4,096 pages per layer and 64 MiB of raw page data, and history is capped at 12 scenes and 48 MiB |
| Robot camera photos | On the robot. Home Assistant holds the 16 newest photos in memory, never in storage or the Recorder |
| Firmware endpoint summaries and research reports | Private storage, up to 52 snapshots and 8 superseded reports; sizes, hashes, and field shapes without payload values, plus any investigator's research text and public source links |
| Activity and enabled entity states | Home Assistant Recorder, according to its configuration |
| Command names, transport outcomes, and raw state transitions with timestamps | Last 512 observations in memory; local events follow Recorder retention |
| Recent room, plan, firmware, and Cues events for the assistant tools | Last 64 in memory, limited to short scalar fields; cleared on restart |

Room lists, Wi-Fi SSID, schedules, detailed session results, and plan history are
live template attributes but are excluded from Recorder. Opt-in room statistics
record room names and durations. The cleaning-finished event includes room
results, so automations or event recording can retain them.

Bluetooth passkeys are used for one pairing attempt and are never stored.
Custom-area coordinates are omitted from entity state, action data, events,
and downloaded diagnostics; automations refer to areas by name.

## Map access

The room camera shows geometry and position. The photographic map can reveal
the interior of your home; its camera is disabled by default. The interactive
map and scene endpoints require an administrator. If you enable the camera,
Home Assistant's camera permissions govern access.

Map responses are not browser-cached. An ordinary reload preserves the local
map store; removing the integration deletes it.

`image.matic_latest_photo` shows pictures the robot took inside your home.
Every Home Assistant user who can see entities can open it; disable the entity
if that is not wanted. Photo patrol links serve the 16 newest photos to any
signed-in user, and are never cached by the browser. Home Assistant backups may
include credentials, plans, and maps—protect backups and screenshots accordingly.

[Photo patrol](photo-patrol.md) needs explicit opt-in and defaults to pixelated
notification previews. Configured no-photo rooms block patrols and manual
snapshots requested through Home Assistant. They do not control the Matic app
or remove existing photos from the robot.

## Assistant tools

The [assistant and MCP tools](assistant-tools.md) are offered only to
administrators. Their results include robot, plan, room, and area names,
cleaning history, and command activity, but no map geometry or area
coordinates. Results go to the conversation agent or MCP client you connect; if
that agent runs in the cloud, they leave your network.

## Matic Cues

The integration receives Cues status and intent categories, not transcripts,
audio, video, person identity, or pointing coordinates.

Enabling Cues activates Matic's separate voice processing. Matic says wake-word
and gesture detection run on the robot; audio after the chime is sent to Gemini.
Read [Matic's voice-data explanation](https://maticrobots.com/blog/how-your-voice-data-is-handled).
The integration offers no recording, clip-sharing, or clip-deletion controls.

## Diagnostics

**Download diagnostics** (Settings > Devices & services > Matic (Unofficial) >
⋮ on the robot's entry) creates a report only when requested. It contains
software/protocol versions, state and error codes, counters, endpoint/map
health, the pairing method, a check that the running code matches the
installed integration files, and the bounded
[command and state observation trail](activity-diagnostics.md).
Observations contain no command payloads or exception messages.
The report omits credentials, addresses, serials, certificate identity, names,
room/map content, Wi-Fi identities, schedules, and detailed cleaning history.
Review any report before sharing it.

## Removing the integration

Deleting the config entry stops access and removes its credential, plans,
areas, map stores, and firmware history from Home Assistant. Backups may retain
older copies. Deletion does not revoke the credential on the robot: no verified
per-user revocation action is available. Contact Matic support if revocation is
needed.
