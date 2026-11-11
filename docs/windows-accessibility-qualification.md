# Windows accessibility qualification pilot

This is an optional, manually dispatched experiment on GitHub-hosted
`windows-2025`. It is not a required check and does not change the Linux CI
routes. Run it with **Actions → Windows assistive qualification (manual) → Run
workflow**. Unsupported desktop, browser, or NVDA conditions fail with an
explicit unqualified result.

The job builds the Map Studio bundle and uses the synthetic local fixture.
It has `contents: read`, uses no Home Assistant credentials or live services,
and does not publish screenshots, video, traces, audio, transcripts, or browser
artifacts. It downloads the official NVDA 2026.2 stable installer, verifies its
published SHA-256 and Authenticode signer, creates a temporary portable copy
with a fresh profile, and disables logging. The test-only passive plugin is
loaded through NVDA's enabled scratchpad directory; the harness leaves
`--disable-addons` off because the pinned NVDA 2026.2
[`addDirsToPythonPackagePath`](https://github.com/nvaccess/nvda/blob/release-2026.2/source/addonHandler/packaging.py#L34-L45)
returns before adding scratchpad paths when that option is set. The profile is
fresh and contains no installed add-ons.

The PowerShell harness reads the initial Windows High Contrast flag, sets and
reads back `HCF_HIGHCONTRASTON` with `SystemParametersInfo`, then restores and
verifies the exact initial flags and default-scheme pointer value in `finally`.
The cleanup distinguishes a null scheme pointer from a non-null empty scheme
string; it reports only scheme presence and SHA-256 values, not the scheme text.
While NVDA runs, headed Edge loads the
packaged Map Studio fixture on loopback and asserts `(forced-colors: active)`.
The Playwright context sets `forcedColors: null` so Edge inherits the Windows
setting; Playwright's default `none` would override the system preference. The
prior native probe (39179377481) observed Windows High Contrast enabled but
Edge forced colors disabled, so that run remains unqualified and provides no
NVDA acceptance evidence.
At initial candidate head `258c503` (based on rc31), probe 39182402998 verified
Edge forced colors active and the fixture scene ready with this setting. It
then failed because NVDA queued no whitelisted speech during OS Tab navigation.
Overall qualification remains unqualified: keyboard-focus, queued-speech, and
audible-output proof are absent, and cleanup reported a scheme mismatch
although the High Contrast flags were restored.
Native Windows keyboard input sends Tab to the focused Edge window, then NVDA's
Insert+Tab report-focus command. A temporary NVDA global plugin passively
observes the documented `speech.extensions.pre_speechQueued` action and
`event_gainFocus`; it forwards normal focus handling and never edits, replaces,
injects, or cancels speech. The pilot requires a matching NVDA-generated
synthetic phrase after actual Tab navigation and after Insert+Tab. The plugin
records only short segments containing a small allowlist of fixture phrases,
with a UTC timestamp, NVDA PID, Edge module, phase, and plugin source hash.
Speech callbacks qualify only when their timestamp is later than the recorded
OS-key-injection boundary for that phase; both timestamps use the Windows UTC
wall clock and are compared as integer nanoseconds. Its JSONL
receipt is job-temporary and deleted during cleanup. The machine-readable
workflow line reports only bounded synthetic phrase matches, versions,
booleans, counts, and status.

## Qualification boundary

`QUEUED_SPEECH_PROOF` means the pinned NVDA process queued the matched phrase
segments for synthesis while OS keyboard input focused the packaged fixture.
This is evidence of generated speech, not proof that audio was audible. The
temporary plugin is a test-only scratchpad component in a fresh portable
profile; it is removed with the NVDA files and is never installed in the
product or uploaded as an artifact. If audio playback is unavailable, queued
speech proof remains separately reported and does not imply physical
screen-reader usability.

This pilot does not establish audible sound delivery, physical screen-reader
usability, Home Assistant runtime behavior, or robot/owner acceptance. Review
the run evidence and the remaining bounds separately from release and physical
qualification.

The run result includes at most 24 bounded browser readiness diagnostics. These
identify the last completed synthetic fixture stage, forced-colors and scene
readbacks, Edge version when available, and a sanitized stage error when
startup fails. Diagnostic paths are redacted and the temporary task directory,
including raw redirected Node logs, is removed before the summary is emitted.

## Sources

- [NVDA stable release files](https://download.nvaccess.org/releases/stable/)
- [NVDA 2026.2 release and published SHA-256](https://github.com/nvaccess/nvda/releases/tag/release-2026.2)
- [NVDA 2026.2 User Guide: Speech Viewer and command-line options](https://download.nvaccess.org/releases/2026.2/documentation/en/userGuide.html)
- [NVDA 2026.2 speech extension source](https://raw.githubusercontent.com/nvaccess/nvda/release-2026.2/source/speech/extensions.py)
- [NVDA 2026.2 Developer Guide: global plugins and extension points](https://download.nvaccess.org/releases/2026.2/documentation/developerGuide.html)
- [Microsoft: High contrast parameter](https://learn.microsoft.com/en-us/windows/win32/winauto/high-contrast-parameter)
- [Playwright: Browser.newContext forcedColors](https://playwright.dev/docs/api/class-browser#browser-new-context-option-forced-colors)
