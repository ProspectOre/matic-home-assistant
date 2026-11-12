# Contributing

Bug reports, protocol findings and pull requests are welcome. You do not need a
robot: the tests and a local Home Assistant both run against a simulated one.

## Set up

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and
[Node.js 24](https://nodejs.org/en/download). uv downloads Python 3.14 and the
locked dependencies the first time you run a command.

```sh
git clone https://github.com/ProspectOre/matic-home-assistant
cd matic-home-assistant
uv run scripts/check.py
```

Base new work on the open `release/X.Y` branch. Base a fix for the current
stable release on `main`.

## Check your change

`uv run scripts/check.py` runs the formatter, linter, type checker, layer and
size rules, privacy scan, and the tests whose imports lead to a changed file.
`uv run ruff format .` fixes formatting.

CI runs the same command with `--all`, which runs every test. On a pull request
it then requires a test to run every line and take every branch that your
change adds to `custom_components/matic_robot`, and names each one that none
does. Code you did not change has no minimum. `uv run scripts/check.py --all`
gives the same answer before you push. Mark a line no test can reach with
`# pragma: no cover` and say why in the same comment.

The tests read Matic Map, the sidebar panel, which is built from
`frontend/map-studio-v4` and not committed. `scripts/check.py` builds it before
it runs tests. To run pytest yourself, build it first with `npm ci` and
`npm run build:map-studio-v4`.

Without uv, install the `test` extra into a Python 3.14 environment and run
`python scripts/check.py`.

## Run without a robot

```sh
npm ci
npm run build:map-studio-v4
uv run tests/live/server.py
```

This builds Matic Map and starts Home Assistant at <http://127.0.0.1:8123> with a simulated robot
already paired and no login. The first start takes about a minute while Home
Assistant installs its frontend. Matic Map is in the sidebar.

A second port moves the robot:

```sh
curl -X POST http://127.0.0.1:8124/step/start_cleaning
curl http://127.0.0.1:8124/state
```

`STEPS` in [tests/live/server.py](tests/live/server.py) names every step, and
the [harness guide](docs/e2e-harness.md) says what the simulator does and does
not model. The same simulator backs `tests/e2e`, so a behavior you can show in
the browser can usually be pinned in a test.

## Frontend

Matic Map lives in `frontend/map-studio-v4`. Use Node.js 24, as CI does.

```sh
npm ci
npx playwright install chromium firefox webkit
npm run test:build
npm run build:map-studio-v4
npm run test:browser
```

Git ignores the build output, so commit the source alone; every CI job builds
its own. On Linux, `npx playwright install --with-deps` also installs system
packages and may need administrator rights. Give each worktree its own
`node_modules`: a shared, symlinked one can change the generated chunks.

`backend-schema.ts` is generated from the schema modules `SCHEMAS` in
`scripts/contract_types.py` names. After changing one, run
`uv run scripts/contract_types.py`; `scripts/check.py` fails until you do.

## Changes and pull requests

A change keeps the rules in [AGENTS.md](AGENTS.md), which apply to people and
coding agents alike and cover privacy and new robot commands. It also updates
the docs and tests it affects.

The pull request template asks what changed, how you tested it, the firmware
you tested with, the [coexistence rules](docs/coexistence.md) the change
touches, and a screenshot for UI changes. Take screenshots from the simulator
so no real home appears.

Before a pull request merges:

- CI passes: Test, Browser UI and Validate.
- Every pull request gets an automated code review of its whole diff. A
  maintainer requests it, so you need no account with any AI service. Answer
  each finding with a fix or a reason.
- A maintainer merges by hand. Auto-merge and force pushes stay off.

Maintainers request the review by commenting `@codex review` on each pushed
head, unless a request for that head is already pending.

## Install a branch build

Every Test run on a pull request or a push to `main` or a release branch keeps
`matic_robot.zip`, built the way a release builds it. To try an unreleased
head, sign in to GitHub, open its Test run under Actions and download
`matic_robot.zip` from Artifacts. Replace `custom_components/matic_robot` in
your Home Assistant configuration with the zip's contents and restart.

## Documentation

Write one guide per task and link to it instead of repeating it. Lead with what
the user can do. Check feature claims against the code. Keep test logs and
development history out of user docs.

## Releasing

Maintainers publish releases, and the owner approves each one. A release is
one run of the Release workflow.

1. By pull request, set the version in `manifest.json` and `pyproject.toml`
   (`0.6.0b1` for the tag `v0.6.0-beta1`, `0.6.0rc1` for `v0.6.0-rc1`), run
   `uv lock`, and write the notes in `docs/release-notes-0.6.0-beta1.md`, named
   as the tag without its `v`. The first line, `# Title`, becomes the release
   title and the rest its body.
2. Run Release from Actions with the tag. A candidate runs on `release/X.Y` or
   `main`. A stable `vX.Y.Z` runs on `main`, after `release/X.Y` is merged
   into it.

The run stops if the tag disagrees with the version or the branch, already
exists or has no notes. Otherwise it builds Matic Map and `matic_robot.zip`,
attests where the zip was built, publishes the release with the zip attached,
then lists and deletes the release and tag of every other candidate of that
version. It never deletes a stable release or tag. Before publishing over a
candidate, record its commit and keep a copy of its zip to roll back to.

HACS installs the zip. To check a copy against the run that built it:

```sh
gh attestation verify matic_robot.zip --repo ProspectOre/matic-home-assistant
```

Install each candidate through HACS beta versions, restart Home Assistant, and
verify the loaded version, the changed behavior and a guarded failure on a
robot. If it fails, fix it and publish the next candidate. After a stable
release, delete the release branch. A fix for a stable release reaches `main`
by pull request.
