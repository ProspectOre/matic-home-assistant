# Security policy

## Supported versions

Security fixes are provided for the latest published release.

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** form as the primary channel. Do
not open a public issue for a credential leak, certificate-validation bypass,
unauthorized command path, or privacy failure.

If the private form is unavailable, open a sanitized bug report asking for a
private contact channel; do not include vulnerability details.

Never attach a live robot credential, local address, serial number, certificate,
packet capture, floor map, room list, device name, app backup, or raw Home
Assistant storage file. Start with the integration version, Home Assistant
version, installation method, sanitized diagnostics, and the smallest synthetic
reproduction possible.

Maintainers will review complete reports and coordinate fixes and disclosure as
appropriate. No response-time or bounty commitment is made.

## Security model

- Setup validates Matic's certificate chain and robot identity before trusting
  the endpoint, then pins the leaf fingerprint in the config entry.
- Bluetooth is used only to issue a robot-scoped local credential during an
  explicit pairing window. When a new Bluetooth pairing is required, the
  robot-displayed passkey is scoped to one attempt and is never persisted or
  included in diagnostics. An existing valid Home Assistant pairing can be
  reused.
- Normal state, maps, and commands travel directly between Home Assistant and
  the robot over the local network.
- Diagnostics redact credentials, endpoints, certificate identity, and serial
  numbers. They retain user-owned map, room, Wi-Fi, and schedule data needed for
  troubleshooting, so users must inspect downloads before sharing them.
- Supported command paths use bounded, validated payloads and are covered by
  automated tests. Core cleaning and settings paths have also been exercised on
  a real robot.

Removing the Home Assistant config entry deletes the integration's stored
local-service credential and stops local access from Home Assistant, but does
not prove robot-side revocation. The tested Matic app and local service expose
no verified per-user removal operation; see the privacy model before treating
entry deletion as token invalidation.
