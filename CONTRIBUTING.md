# Contributing

## Development

Requires Python 3.14 and Node.js for frontend work.

The test extra pins `pytest-homeassistant-custom-component==0.13.366`, which
requires stable Home Assistant `2026.9.3`. Plugin `0.13.368` selects Home
Assistant `2026.10.0b0`, so beta compatibility is qualified separately before
changing this baseline. This test pin does not change the integration's Home
Assistant 2026.7+ runtime support.

```sh
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest --cov=custom_components/matic_robot --cov-report=term-missing
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy custom_components/matic_robot
.venv/bin/python scripts/check_public_tree.py
```

For Map Studio changes, use Node.js 24, matching CI. Run `npm ci` in the
checkout, then `npm run build:map-studio-v4` and `npm run test:browser`.
Do not share a symlinked `node_modules` directory across worktrees; module
resolution can change the generated chunks. Commit the rebuilt bundle with its source.

Python 3.14's unparenthesized multiple exception types are intentional project
style. Keep runtime traffic local and use Home Assistant's asynchronous APIs.

## CI routing

Matic is a public repository. Test, Browser, and Validate run on standard
GitHub-hosted `ubuntu-latest` runners, which are
[free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Use the existing hosted workflows; private-repository paid-minute limits and
missing self-hosted runners do not block this route. A local Linux VM is not a
prerequisite. Larger runners and storage/cache allowances have separate billing.
Recheck the route if repository visibility or runner configuration changes.

Hosted CI does not replace exact-head review, manual merge, approved RC
installation, runtime verification, physical acceptance, or release permission.

## Changes and pull requests

- Explain the user-visible change briefly; update relevant docs and tests.
- Use synthetic fixtures. Keep credentials, identifiers, room names, maps,
  captures, backups, raw timings, and Home Assistant storage out of public files and discussion.
- Preserve TLS validation, certificate pinning, diagnostic privacy, entity availability, and unload cleanup.
- New commands require an exact synthetic fixture, successful robot validation, and Home Assistant-native error handling. Never guess enums or payloads.
- Pairing changes must preserve the scoped BlueZ agent and cover success, malformed/rejected/expired codes, cancellation, and unavailable adapters.
- Tests must retain 100% coverage. Required CI, privacy, HACS, Hassfest, and review must pass before a manual merge.

## Documentation

Lead with what users can do, especially plan logic and Home Assistant workflows
that add to the native app. Verify feature claims against code and native-app
comparisons against Matic documentation. Keep instructions in one task-specific
guide and link to it. Include limits only where they affect the task; avoid
repeated warnings. Preserve release notes as historical records, focused on
user-visible changes. Keep test logs and development diaries out of user docs.

## Releasing

1. Merge, then publish `vX.Y.Z-rcN` as a GitHub pre-release.
2. Install it through HACS beta versions and restart Home Assistant.
3. Verify the loaded version, changed behavior, and guarded failure on the robot.
4. Publish `vX.Y.Z` from the same commit after validation succeeds.

If a candidate fails, fix it and publish the next candidate. Group related fixes
into one release.
