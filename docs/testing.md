# Testing

[Contributing](../CONTRIBUTING.md) · [Simulated robot](e2e-harness.md) ·
[Plan run contract](e2e-contract.md)

[Contributing](../CONTRIBUTING.md) has the commands. This page says
what each kind of test proves, so a change gets the right one. Everything that
runs in CI uses synthetic fixtures: no test there talks to a real robot or a
real home.

## What runs on every pull request

| Tests | Where | What they prove |
| --- | --- | --- |
| Python | `tests/test_*.py` | The integration's logic. A pull request needs one of them to run every line and take every branch it adds to `custom_components/matic_robot`. `tests/test_release_metadata.py` also holds versions, the documented actions and entities, and the wording of the household guides ([copy style](copy-style.md)) to what the code ships. |
| Simulated robot | `tests/e2e` | Home Assistant, the config entry and the real client against [a simulated robot](e2e-harness.md), with nothing between them mocked. The [plan run contract](e2e-contract.md) lists the outcomes these tests hold. |
| Frontend modules | `tests/node` | The build tools and the Matic Map modules that need no browser (`npm run test:build`). |
| Browser | `tests/browser` | Matic Map, built by `npm run build:map-studio-v4`, on synthetic fixtures in Chromium, Firefox and WebKit, with emulated phone sizes (`npm run test:browser`). |
| Live browser | `tests/live` | Matic Map inside a real Home Assistant frontend paired to the simulated robot (`npx playwright test --config playwright.live.config.mjs`). |
| Public tree | `scripts/check_public_tree.py` | No private file type, address or identifier is committed. |

A passing run shows the code does what the fixtures describe. It doesn't show
that a release was installed, that a real robot accepts a command or that a
person can use the page on a real phone.

## What runs by hand

| Check | What it adds |
| --- | --- |
| [Installed check](installed-check.md) | Which files a real Home Assistant host installed and loaded, and optionally one real room clean. Needs the owner's go. |
| [Upgrade drill](upgrade-drill.md) | Upgrading from an older release and rolling back, on the simulated robot with real store files. |
| [Map capacity lab](performance-map-lab.md) | Size and memory limits of Matic Map on synthetic homes. |
| Interface stage (below) | Any Matic Map state at any screen size, for looking at a layout or reading its copy. |
| Windows screen reader pilot (below) | Whether NVDA and Edge's forced colors work with Matic Map on Windows. |

A new robot command also needs a successful try on a real robot
([Contributing](../CONTRIBUTING.md#changes-and-pull-requests)), and the
[compatibility table](firmware-compatibility.md#robot-firmware) records what
was tried on each firmware.

## Interface stage

The stage shows the shipped Matic Map code on synthetic data, one journey at
one screen size per cell. `scripts/walkthrough_cells.json` lists 13 journeys
and 9 setups, 117 cells, each with what to check.

```sh
npm run build:map-studio-v4
npm run stage:walkthrough -- --list
npm run stage:walkthrough -- R01-C01
```

The last command serves the cell on `http://127.0.0.1:4180` and prints its URL
and what to try. `--print` prints the URL without opening a browser, `--port`
picks another port and `--lan` also serves the cell on the local network, for a
real phone or tablet, until you stop the script. A banner on the page has one
button per step of the journey. A misspelled step or setting shows an error and
is never staged as another state. The screenshot in the project overview is
cell `R01-C04`, so it shows a synthetic home.

`npm run audit:ux` captures every staged state at each supported width, runs
axe on it and writes a summary under the git-ignored `tests/browser/.generated/`.
It reports and never gates. The scripts in
[`tests/browser/ux-audit-tools`](../tests/browser/ux-audit-tools/README.md)
measure one thing each: layout, touch targets, keyboard order, contrast,
forced colors and zoom.

## Windows screen reader pilot

**Windows assistive qualification (manual)** is an optional workflow started
from the Actions tab. On a hosted Windows runner it builds Matic Map, turns on
High Contrast, opens the build in Edge and checks that Edge reports forced
colors and that NVDA 2026.2 queues the expected phrases after real Tab and
Insert+Tab key presses. `scripts/qualify_windows_accessibility.ps1` is the
whole procedure.

It shows that NVDA generated speech, not that anyone heard it, and it is not a
required check. Matic Map has not passed it yet, which is why a Windows screen
reader is listed under [known limits](firmware-compatibility.md#known-limits).
