# Contributing

## Development

Requires Python 3.14 and Node.js for frontend work.

```sh
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest --cov=custom_components/matic_robot --cov-report=term-missing
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy custom_components/matic_robot
.venv/bin/python scripts/check_public_tree.py
```

For Map Studio changes, run `npm ci`, `npm run build:map-studio-v4`, and
`npm run test:browser`. Commit the rebuilt bundle with its source.

Python 3.14's unparenthesized multiple exception types are intentional project
style. Keep runtime traffic local and use Home Assistant's asynchronous APIs.

## Changes and pull requests

- Explain the user-visible change briefly; update relevant docs and tests.
- Use synthetic fixtures. Keep credentials, identifiers, room names, maps,
  captures, backups, raw timings, and Home Assistant storage out of public files and discussion.
- Preserve TLS validation, certificate pinning, diagnostic privacy, entity availability, and unload cleanup.
- New commands require an exact synthetic fixture, successful robot validation, and Home Assistant-native error handling. Never guess enums or payloads.
- Pairing changes must preserve the scoped BlueZ agent and cover success, malformed/rejected/expired codes, cancellation, and unavailable adapters.
- Tests must retain 100% coverage. Required CI, privacy, HACS, Hassfest, and review must pass before a manual merge.

## Documentation

Describe the feature or required action. Keep release notes focused on changes
users can see. Put instructions and compatibility details in one relevant guide;
keep test logs, review narration, and development diaries out of user docs.

## Releasing

1. Merge, then publish `vX.Y.Z-rcN` as a GitHub pre-release.
2. Install it through HACS beta versions and restart Home Assistant.
3. Verify the loaded version, changed behavior, and guarded failure on the robot.
4. Publish `vX.Y.Z` from the same commit after validation succeeds.

If a candidate fails, fix it and publish the next candidate. Group related fixes
into one release.
