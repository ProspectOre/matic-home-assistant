# AGENTS

Facts an agent needs to change this repository. Everything it refers to is in
this repository. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, pull requests
and review.

## Commands

- `uv run scripts/check.py` runs the formatter, linter, type checker, layer and
  size rules, privacy scan, and the tests whose imports lead to a changed
  file. Run it before every push. CI runs it with `--all`: every test, and on
  a pull request a test must run every line and take every branch the change
  adds to `custom_components/matic_robot`. The rest has no minimum.
- `uv run ruff format .` fixes formatting.
- After changing dependencies in `pyproject.toml`, run `uv lock` and commit
  `uv.lock`. CI installs with `--locked` and fails on a stale lockfile.
- Matic Map's build output is not committed. The tests read it, so
  `scripts/check.py` builds it first, which needs Node.js 24. Frontend changes
  have their own commands; see [CONTRIBUTING.md](CONTRIBUTING.md#frontend).
- Python 3.14 syntax is intended, including `except A, B:` without parentheses.
- Home Assistant 2026.10 is the oldest supported version (`hacs.json`).
  `pyproject.toml` pins the version the tests run on.

## Layers

`scripts/check.py` fails on an import that crosses one of these lines:

- `custom_components/matic_robot/client/` is the robot protocol client. It
  imports nothing from Home Assistant or from the rest of the integration.
  The rest of the integration imports only the names `client/__init__.py`
  exports, never a module below it. Its tests in `tests/client` also run
  with Home Assistant blocked.
- The plan core holds plan values and accounting rules; `PLAN_CORE` in
  `scripts/check.py` lists its modules. It imports the client and itself,
  never Home Assistant.
- Entity platforms, the modules with `async_setup_entry` such as `sensor.py`
  and `vacuum.py`, do not import each other. Shared code goes in a module both
  import.

It also holds every code file to 1,000 lines. `scripts/oversize_files.txt`
records each older, larger file at the size it may not exceed, so put new code
and new tests in a new file. [Architecture](docs/architecture.md) maps the
modules.

## Privacy

- Use synthetic fixtures. Keep credentials, serial numbers, MAC and IP
  addresses, room names, maps, photos, captures, backups and Home Assistant
  storage out of files, commits, issues and pull requests. The privacy scan
  rejects the common ones.
- Robot traffic stays on the local network. Keep TLS validation, certificate
  pinning and diagnostic redaction intact.

## Robot behavior

- Never guess a command, enum or payload. A new command needs a payload
  fixture recorded from a robot and one check on a robot. If you cannot run
  that check, say so in the pull request.
- Before calling a field or capability unavailable, establish whether the
  robot never sends it or the parser drops it.
- Code that reads robot state or sends a command follows
  [working alongside the Matic app](docs/coexistence.md).
- Pairing changes keep the scoped BlueZ agent and cover success, malformed,
  rejected and expired codes, cancellation and a missing adapter.
- Entities become unavailable when the robot is unreachable, and unloading the
  entry releases everything it started. Use Home Assistant's asynchronous APIs.

## Running without a robot

- `tests/e2e` runs Home Assistant and the real client against the simulated
  robot in `tests/e2e/hermes_sim.py`, as part of pytest.
- `uv run tests/live/server.py` serves Home Assistant with that robot paired.
  [CONTRIBUTING.md](CONTRIBUTING.md#run-without-a-robot) has the steps.
- A simulator pass shows that the integration agrees with the simulator. It is
  not evidence about a real robot; do not present it as such.

## CI

- Test, Browser UI and Validate run on GitHub-hosted runners for every pull
  request and every push to `main` or a release branch. A test rejects any
  other runner.
- Nightly runs the tests and the live lane on the oldest supported, newest
  stable and beta Home Assistant. GitHub starts it from the default branch
  only.
- Test builds and keeps `matic_robot.zip`, the file HACS installs, for every
  head it runs on. Release builds the same zip, publishes it as a release and
  deletes superseded candidates. Only a maintainer with the owner's approval
  runs it; see [CONTRIBUTING.md](CONTRIBUTING.md#releasing).
- `.github/delivery-contract.json` must list every workflow file.
  `.github/scripts/delivery-contract.py` checks that first in Test.

## Writing

Write comments, commits, pull request text and docs plainly and specifically:
no filler, hype or restated summaries. Name branches by purpose. Never add AI
or tool attribution or co-author trailers.
