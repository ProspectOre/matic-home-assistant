# Contributing

Bug reports, protocol findings and pull requests are welcome. You do not need a
robot: the tests and a local Home Assistant both run against a simulated one.

## Set up

Install [uv](https://docs.astral.sh/uv/getting-started/installation/). It
downloads Python 3.14 and the locked dependencies the first time you run a
command.

```sh
git clone https://github.com/ProspectOre/matic-home-assistant
cd matic-home-assistant
uv run scripts/check.py
```

Base new work on the open `release/X.Y` branch. Base a fix for the current
stable release on `main`.

## Check your change

`uv run scripts/check.py` runs the formatter, linter, type checker, layer and
size rules, privacy scan, and the tests that import a changed file or a module
that imports one. CI runs the same command with `--all`, which runs every test
and requires 100% line coverage. `uv run ruff format .` fixes formatting.

Without uv, install the `test` extra into a Python 3.14 environment and run
`python scripts/check.py`.

## Run without a robot

```sh
uv run tests/live/server.py
```

This starts Home Assistant at <http://127.0.0.1:8123> with a simulated robot
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

Commit the rebuilt bundle with its source; CI rebuilds it and fails on a
difference. On Linux, `npx playwright install --with-deps` also installs system
packages and may need administrator rights. Give each worktree its own
`node_modules`: a shared, symlinked one can change the generated chunks.

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

## Documentation

Write one guide per task and link to it instead of repeating it. Lead with what
the user can do. Check feature claims against the code. Keep test logs and
development history out of user docs.

## Releasing

Maintainers publish releases, and the owner approves each one.

1. Merge reviewed work into `release/X.Y` and publish a candidate from it as a
   GitHub pre-release.
2. Install the candidate through HACS beta versions, restart Home Assistant,
   and verify the loaded version, the changed behavior and a guarded failure
   on a robot.
3. If the candidate fails, fix it and publish the next one. Keep only the
   newest candidate's release and tag; record the commit of each earlier one
   and keep a copy to roll back to.
4. Merge `release/X.Y` into `main`, publish `vX.Y.Z` from that merge commit,
   then delete the branch and the candidate's release and tag. Stable releases
   and tags stay. A fix for a stable release reaches `main` by pull request.
