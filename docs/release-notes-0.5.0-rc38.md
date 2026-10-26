# v0.5.0-rc38

RC38 brings the RC37 qualification fixes together for a new installed test cycle.

- Keep controls inside Safari's visible viewport, preserve fixed inspector
  widths under Home Assistant fonts, and keep crowded room labels readable.
- Publish saved Home choices together when metadata arrives, retain known
  choices during refresh, and keep recovery controls available while loading.
- Show verified rooms completed out of the active room run’s fixed total beside
  the current room, with entry/run identity checks and the existing fallback.
- Show the current room's clearly labeled Estimated %, using the same active
  clock and successful-duration baseline as Stop. Expose active time, expected
  duration and estimated progress as three Home Assistant sensors that refresh
  together. Pauses freeze time; fewer than three matching samples leaves the
  estimate unknown. Estimated 100% never grants completion credit.
  The MCP status tool reads that same sample without recalculating it.
- Retain incomplete and unverified run summaries after idle/docking, including
  low-charge suspension. Active work and current map warnings retain priority;
  successful completion stays quiet. Cleaning credit rules are unchanged.
- Preserve the live camera while browsing saved maps, restore the camera after
  discarding an area review, and keep tilt steady during two-finger panning.
- Recover saved areas, clarify map and recovery guidance, isolate bidirectional
  phrases, and refresh saved-plan cadence during fallback polling.
- Allow a bounded undocking interval before coverage-start readback fails.
- Offer experimental pairing import on hosts without a local Bluetooth adapter,
  including reauthentication and reset recovery. Validate robot identity and
  authentication before saving; cancel removed flows and finish repeated
  submissions once. See the [integration contract](pairing-import-contract.md).

The external pairing helper is separate. Its contributor owns credential
acquisition, output handling, platform tests and real-robot refusal evidence;
this release does not certify that helper. Keep credentials out of reports.

The frontend preserves complete license companions and uses conservative
compaction within the existing 92,416-byte compressed startup budget.

Before updating, preserve a verified Home Assistant backup, the installed
integration and its current plan/configuration stores. A source-only downgrade
does not necessarily restore newer stored run data; see the
[rollback guidance](verification-0.5-rc24.md).

These are source changes for a prerelease. They require installation, loaded
file/runtime verification and candidate-specific device and physical retesting.
RC37 results do not qualify RC38. Whole-product owner acceptance and stable
publication remain open under the [0.5 acceptance criteria](acceptance-0.5.md).
