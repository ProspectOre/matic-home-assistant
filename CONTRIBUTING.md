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
.venv/bin/mypy custom_components
.venv/bin/python scripts/check_public_tree.py
```

Keep changes local-only and asynchronous. Preserve TLS identity validation,
certificate pinning, diagnostic redaction, config-entry unloading, and entity
availability behavior.

Pairing changes must preserve the scoped BlueZ agent and must cover successful,
malformed, rejected, expired, cancelled, and adapter-unavailable passkey paths.
Tests and logs must never contain a real robot-displayed code or credential.

Do not add a command from a guessed enum or payload. A command contribution
must include a byte-for-byte synthetic fixture, evidence that the real robot
accepted it safely, and error handling that surfaces a Home Assistant-native
exception.

## Pull requests

- Explain the user-visible behavior and security impact.
- Add or update tests and documentation.
- Keep protocol captures and live-device evidence private; describe the result
  without attaching the underlying data.
- Confirm that tests, Ruff, the privacy check, Hassfest, and HACS validation pass.
