# Matic firmware vNNN

[Endpoint map](../firmware-endpoint-map.md) ·
[Firmware ledger](../firmware-compatibility.md)

status: observed / live validation pending  
first_observed_pacific: YYYY-MM-DD  
integration_version: X.Y.Z  
home_assistant_version: YYYY.M  
protocol_version: N

## Endpoint snapshot

| Surface | Status | Evidence / delta from preceding firmware |
| --- | --- | --- |
| Discovery and `GetBotInfo` | Pending | |
| Authentication, handshake and session data | Pending | |
| Core reads: `kabuki_state`, `coverage_plan`, `latest_pose` | Pending | |
| 15 telemetry properties | Pending | |
| Schedule and coverage-history collections | Pending | |
| Dock and sink collection counts | Pending | |
| Allowlisted exploratory reads | Pending | |
| Stop, pause, resume and dock | Not tested | |
| Coverage/room commands and cleaning settings | Not tested | |

## Changes and capability candidates

- Release notes:
- Observed behavior changes:
- Regressions:
- New or changed fields/collections:
- Possible safe Home Assistant exposure:

## Promotion checklist

- [ ] Record integration, Home Assistant and protocol versions.
- [ ] Confirm coordinator refresh and decoded reads.
- [ ] Run a hash-only exploratory availability sweep.
- [ ] Review privacy-safe diagnostics for protocol drift.
- [ ] Compare with the preceding firmware snapshot.
- [ ] Exercise supported writes deliberately and record exact coverage.
- [ ] Link sanitized fixtures, tests, issues and pull requests.
- [ ] Update the public ledger and workspace firmware memory.

Never commit downloaded diagnostics, raw robot payloads, credentials, network or
device identifiers, maps, room names, Wi-Fi details, or other home data.

