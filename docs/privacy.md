# Privacy and local-data model

After one-time authorization, Home Assistant talks directly to the robot's
encrypted local service. Routine control, state, and maps stay inside the home.
The integration does not require Matter, Apple Home, a Matic cloud session, an
app backup, analytics, or a maintainer-operated service.

## Data stored by Home Assistant

The config entry stores the robot's local endpoint, certificate identity and
fingerprint, serial number, and robot-issued local access credential. These are
needed to reconnect securely and are covered by Home Assistant backups.
The six-digit Bluetooth passkey shown on the robot is used only by the active
pairing attempt; it is not stored in the config entry, logs, diagnostics, or
rotation history.

The entity state machine may contain activity, battery, room names and IDs,
firmware metadata, current/previous area, preference states, Wi-Fi SSIDs and
scan results, schedules, cleaning histories, and diagnostic state. Home
Assistant's recorder may retain historical entity states according to the
user's recorder settings. The local map camera renders room geometry and robot
pose on demand; it contains no optical camera frames.

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
completion timestamps, and failure summaries. It never leaves Home Assistant.

## Data never sent to this project

The integration contains no telemetry, crash uploader, analytics endpoint, or
maintainer cloud. Repository CI uses synthetic fixtures only.

## Diagnostics

This section applies only when a user explicitly clicks **Download diagnostics**
for the integration in Home Assistant. The integration does not generate,
upload, or send a diagnostic report automatically.

The user-downloaded report never includes the pairing passkey. It redacts the
stored credential, host and hostname, IP addresses, serial number, and
certificate fingerprint. It intentionally retains the user-assigned name,
floor plan, room names/geometry, pose, current/previous areas, Wi-Fi SSIDs/scans,
schedules, history, and decoded diagnostic state. That local context is often
the evidence needed to diagnose firmware and mapping behavior. The report does
not include recording metadata, thumbnails, clip bytes, pairing material,
Wi-Fi passwords, account tokens, Matter codes, or packet captures.

Treat a diagnostics download, log, or screenshot as private home data and
inspect it before sharing publicly.

## Deauthorization

Delete the integration entry in Home Assistant to stop access and erase Home
Assistant's stored credential. This does not prove that the robot has erased its
copy of the token.

The tested Matic app can add a user but does not show an authorized-user list or
a per-user removal control. The integration has no verified way to revoke one
credential on the robot. Do not use **Factory Reset** only to remove Home
Assistant; it resets the whole robot. Contact Matic support if robot-side
invalidation is required.
