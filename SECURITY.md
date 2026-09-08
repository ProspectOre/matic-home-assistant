# Security

Security fixes target the latest release.

## Report a vulnerability

Use GitHub's [private vulnerability report](https://github.com/ProspectOre/matic-home-assistant/security/advisories/new).
If unavailable, open a sanitized issue asking for a private contact channel.
Include versions and a minimal synthetic reproduction; keep credentials, home
data, captures, and raw storage out of public reports.

## Security model

- Setup validates the robot's certificate and identity, then pins its fingerprint.
- Bluetooth issues a local credential during pairing; passkeys are never stored.
- Normal state, maps, and commands use an encrypted LAN connection.
- Home Assistant permissions restrict commands and administrator-only map access.
- Protocol inputs are validated and bounded; diagnostics omit private home data.

Deleting the integration removes its local credential and stored data from
Home Assistant. It does not revoke the robot's copy or erase backups.
See the [privacy guide](docs/privacy.md).
