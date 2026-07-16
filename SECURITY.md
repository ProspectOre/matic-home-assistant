# Security policy

## Supported versions

The `0.1.x` release line receives security fixes. Earlier pre-release states are
not supported and do not receive fixes.

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** form as the primary channel. Do
not open a public issue for a credential leak, certificate-validation bypass,
unauthorized command path, or privacy failure.

If private advisories are unavailable, open an issue that requests maintainer
contact without any technical detail, and share the report privately once
contact is established.

Never attach a live robot credential, local address, serial number, certificate,
packet capture, floor map, room list, device name, app backup, or raw Home
Assistant storage file. Start with the integration version, Home Assistant
version, installation method, sanitized diagnostics, and the smallest synthetic
reproduction possible.

The maintainers will acknowledge a complete report, reproduce it privately, and
coordinate a fix and disclosure. No response-time or bounty commitment is made.

## Security model

- Setup validates Matic's certificate chain and robot identity before trusting
  the endpoint, then pins the leaf fingerprint in the config entry.
- Bluetooth is used only to issue a robot-scoped local credential during an
  explicit pairing window. The robot-displayed passkey is scoped to one attempt
  and is never persisted or included in diagnostics.
- Normal state, maps, and commands travel directly between Home Assistant and
  the robot over the local network.
- Diagnostics redact credentials, endpoints, certificate identity, and serial
  numbers. They retain user-owned map, room, Wi-Fi, and schedule data needed for
  troubleshooting, so users must inspect downloads before sharing them.
- Commands are exposed only after their protocol payloads are verified against
  a real robot and locked down with synthetic tests.

Removing the Home Assistant config entry erases its credential and stops local
access from Home Assistant, but does not prove robot-side revocation. The tested
Matic app and local service expose no verified per-user removal operation; see
the privacy model before treating entry deletion as token invalidation.
