# Privacy

[Documentation](README.md) · [Security](../SECURITY.md)

Routine control, maps, and state travel directly between Home Assistant and the
robot over an encrypted LAN connection. The integration has no telemetry,
analytics, or maintainer cloud service.

## Stored data

| Data | Where it lives |
| --- | --- |
| Local credential, endpoint, and certificate identity | Home Assistant config entry |
| Plans, room preferences, results, and custom-area geometry | Private integration storage |
| Current photographic map and saved map history | Private integration storage; history is capped at 12 scenes and 48 MiB |
| Firmware endpoint summaries | Private storage, up to 52 snapshots; sizes, hashes, and field shapes without payload values |
| Activity and enabled entity states | Home Assistant Recorder, according to its configuration |

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
map store; removing the integration deletes it. Home Assistant backups may
include credentials, plans, and maps—protect backups and screenshots accordingly.

## Matic Cues

The integration receives Cues status and intent categories, not transcripts,
audio, video, person identity, or pointing coordinates.

Enabling Cues activates Matic's separate voice processing. Matic says wake-word
and gesture detection run on the robot; audio after the chime is sent to Gemini.
Read [Matic's voice-data explanation](https://maticrobots.com/blog/how-your-voice-data-is-handled).
The integration offers no recording, clip-sharing, or clip-deletion controls.

## Diagnostics

**Download diagnostics** creates a report only when requested. It contains
software/protocol versions, state and error codes, counters, and endpoint/map
health. It omits credentials, addresses, serials, certificate identity, names,
room/map content, Wi-Fi identities, schedules, and detailed cleaning history.
Review any report before sharing it.

## Removing the integration

Deleting the config entry stops access and removes its credential, plans,
areas, map stores, and firmware history from Home Assistant. Backups may retain
older copies. Deletion does not revoke the credential on the robot: no verified
per-user revocation action is available. Contact Matic support if revocation is
needed.
