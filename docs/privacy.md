# Privacy and local-data model

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

After one-time authorization, Home Assistant talks directly to the robot's
encrypted local service. Routine control, state, and maps stay inside the home.
The integration does not receive or store Matic account or cloud-session
credentials and does not use Matter, Apple Home, app backups, analytics, or a
maintainer-operated service.

## Data stored by Home Assistant

The config entry stores the robot's local endpoint, certificate identity and
fingerprint, serial number, and robot-issued local access credential. These are
needed to reconnect securely and are covered by Home Assistant backups.
Any six-digit Bluetooth passkey shown on the robot is used only by the active
pairing attempt; it is not stored in the config entry, logs, diagnostics, or
rotation history.

The entity state machine contains activity, battery, firmware metadata,
current/previous Area context, preference state, summary counts, and diagnostic
state. High-context diagnostic entities are disabled by default. Attributes
that carry home context — the connected Wi-Fi SSID, schedule definitions, room
names and IDs, the latest session's rooms and durations, and full plan/history
records — stay live on the state machine for templates but are declared
unrecorded, so Home Assistant's recorder never writes them to the history
database. The neighbor Wi-Fi scan list is not exposed at all. Two exceptions
are deliberate and opt-in or explicit: the per-room statistics sensors are
disabled by default and, when a user enables them, record that room's name and
cleaning durations as long-term statistics; and the
`matic_robot_cleaning_finished` event includes the finished session's rooms
and per-room durations in its payload. Home Assistant's recorder retains
enabled entity states according to the user's recorder settings. The local map
camera renders room geometry and robot pose on demand; it contains no optical
camera frames.

The integration does not start camera or microphone recordings, request clip
bytes or thumbnails, cache media, expose recording metadata, or send vendor
share or discard decisions. Those are support-oriented and privacy-sensitive
operations. Vendor sharing has an external effect, and a request to discard or
delete a clip may be irreversible even though downstream handling and retention
cannot be verified locally. They are therefore outside the integration's
reliable local-control contract. See
[Recording-related protocol notes](recording-protocol.md) for the observed but
unavailable protocol semantics.

Managed rotation history is stored in Home Assistant's local `.storage`
directory. It contains selected room IDs/names, individual room preferences,
completion timestamps, and failure summaries. The integration does not
transmit this history. Home Assistant backups may include it according to the
user's backup configuration.

## Data never sent to this project

The integration contains no telemetry, crash uploader, analytics endpoint, or
maintainer cloud. Repository CI uses synthetic fixtures only.

## Diagnostics

This section applies only when a user explicitly clicks **Download diagnostics**
for the integration in Home Assistant. The integration does not generate,
upload, or send a diagnostic report automatically.

The user-downloaded report is constructed from an explicit safe-field allowlist,
not a best-effort redaction denylist. It omits the pairing passkey, stored
credential, host/hostname, addresses, serial number, certificate identity,
user-assigned names, floor geometry, pose, current/previous areas, room data,
Wi-Fi SSIDs/scans, schedule definitions, session details, and full plan history.
It retains protocol/build versions, boolean/counter summaries, state/error codes,
map availability/counts, payload-free endpoint health, and firmware-snapshot
counts needed to diagnose compatibility.

Still inspect a diagnostics download, log, or screenshot before sharing it.

## Deauthorization

Delete the integration entry in Home Assistant to stop access and erase Home
Assistant's stored credential. This does not prove that the robot has erased its
copy of the token.

The tested Matic app can add a user but does not show an authorized-user list or
a per-user removal control. The integration has no verified way to revoke one
credential on the robot. Do not use **Factory Reset** only to remove Home
Assistant; it resets the whole robot. Contact Matic support if robot-side
invalidation is required.
