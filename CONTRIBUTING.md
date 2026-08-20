# Contributing

Thank you for helping improve Matic for Home Assistant.

## Privacy first

Use synthetic fixtures only. Never commit or post robot credentials, addresses,
serial numbers, certificates, packet captures, floor maps, room names, device
names, app backups, or Home Assistant storage files. Run the public-tree privacy
check before every pull request.

## Development

```sh
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy custom_components/matic_robot
.venv/bin/python scripts/check_public_tree.py
```

Keep runtime communication local and use Home Assistant's asynchronous APIs.
Preserve TLS identity validation, certificate pinning, diagnostic redaction,
clean config-entry unloading, and entity availability behavior.

Pairing changes must preserve the scoped BlueZ agent and must cover successful,
malformed, rejected, expired, cancelled, and adapter-unavailable passkey paths.
Tests and logs must never contain a real robot-displayed code or credential.

Do not add a command from a guessed enum or payload. A command contribution
must include a byte-for-byte synthetic fixture, a brief description of
successful live-device validation without private data, and error handling that
surfaces a Home Assistant-native exception.

## Pull requests

- Explain the user-visible behavior and security impact.
- Add or update tests and documentation.
- Keep protocol captures and live-device evidence private; describe the result
  without attaching the underlying data. That includes pull request and issue
  text: no real room names, household names, addresses, serials, or raw
  timings from a real home.
- Confirm that tests, Ruff, the privacy check, Hassfest, and HACS validation pass.

## Releasing

A green test suite proves the code does what its tests say. It does not prove
the robot behaves as expected, and several defects here were only visible on
real hardware. Every release therefore goes out as a candidate first.

1. Merge the change and tag a candidate from the merge commit as a GitHub
   **pre-release**: `vX.Y.Z-rcN`. HACS does not offer a pre-release as an
   update unless a user opts in, so publishing one is safe.
2. Install it on a real robot: HACS -> the integration -> Redownload ->
   enable **Show beta versions** -> pick the candidate -> restart Home
   Assistant.
3. Verify against the robot, not the test suite. Confirm the loaded version,
   exercise the behavior the change claims to fix, and confirm the failure it
   guards against still fails closed.
4. Promote only after that passes: publish `vX.Y.Z` as a normal release from
   the same commit. If the candidate misbehaves, nothing was ever offered to
   users; fix it and cut `-rc2`.

Fold related fixes into one candidate rather than publishing a string of
point releases.
