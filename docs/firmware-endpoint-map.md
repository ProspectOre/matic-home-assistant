# Firmware endpoint and Home Assistant map

[Firmware ledger](firmware-compatibility.md) ·
[Entity reference](automation.md#entity-contract)

This is the integration's public protocol inventory. “Endpoint” means a Hermes
gRPC method, collection/property name, or channel—not an HTTP endpoint. The
inventory says what the code understands; each firmware snapshot records what a
real robot actually returned after an OTA.

## gRPC methods

| Method | Use | Home Assistant surface |
| --- | --- | --- |
| `GetBotInfo` | Local identity, network and hardware metadata | Device info; hardware revision sensor; sensitive fields redacted |
| `AuthToken` | Issue a scoped credential during physical Bluetooth pairing | Config/reauth flow only |
| `Handshake` | Bind the authenticated Hermes session | Internal transport |
| `FetchCollection` | Read typed properties and bounded collection streams | Coordinator reads; payload-free inspection and firmware-snapshot actions |
| `SendToChannel` | Send verified session data, settings and commands | Vacuum/settings entities and actions below |

## Decoded reads

| Collection/property | Decoded data | Current HA exposure |
| --- | --- | --- |
| `kabuki_state` | Battery, state/error codes, activity, firmware fallback, channel/profile, current/previous area | Vacuum; activity, battery and current-area sensors; seven operational binary sensors; attributes |
| `coverage_plan` | Mission, partition, named room IDs and geometry | Rooms sensor, map camera, vacuum segments/Areas, cleaning target |
| `latest_pose` | Robot position and heading | Map camera |
| `current_version` | Software/profile, protocol version, feature flag | Software and protocol sensors; software attributes |
| `update_config` | Update channel | Update-channel sensor |
| `update_state` | Update lifecycle | Update-state sensor and update-available binary sensor |
| `wifi_status` | State, SSID, signal and visible/known networks | Wi-Fi state/signal/count summary; identities excluded from attributes |
| `time_zone` | Robot timezone | Internal decoded telemetry; excluded from recorder attributes |
| `schedule_events` | Local schedules, weekdays, time, rooms, ordering and enabled state | Scheduled-cleanings count; definitions excluded from attributes |
| `coverage_session_history` | Local session count and latest session summary | Local-cleaning-session count and non-room summary |
| `dock_detections` | Collection count | Dock-detections sensor |
| `sink_summon_locations` | Collection count | Sink-summon-locations sensor |
| `coverage_time` | Accumulated coverage seconds | Coverage-time sensor |
| `child_lock_enabled_state` | Child-lock state | Child-lock switch |
| `petwaste_enabled_state` | Pet-waste avoidance state | Pet-waste-avoidance switch |
| `voice_enabled_state` | Hey Matic state | Voice-assistant switch |
| `matter_pairing_state` | Pairing-mode presence | Matter-pairing binary sensor |
| `deep_mop_override_setting_state` | Double-pass mop state | Deep-mop switch |
| `water_flow_override_state` | Water-flow multiplier | Water-flow number |
| `user_tunnel_ssh_permission` | Robot SSH permission | Diagnostic binary sensor |
| `uploader_config_state` | Robot diagnostic-upload opt-in | Diagnostic-upload binary sensor |
| `active_session_key` | Active cleaning-session presence | Active-cleaning-session binary sensor |

## Allowlisted exploratory reads

These are bounded, payload-free reads through `inspect_hermes_endpoint` and the
weekly `firmware_snapshot` action. Payloads are not decoded into entities unless listed above. “Candidate” is a
research direction, not a promise that the field exists or is safe on every
firmware.

| Collections | Possible safe HA use after evidence |
| --- | --- |
| `approximate_trajectory`, `planned_path` | Map path overlays or path-status diagnostics |
| `coverage_corridor`, `coverage_marker` | Coverage/map annotations |
| `coverage_session_thumbnails` | Local historical map thumbnail |
| `displayed_mission`, `labeled_missions` | Mission identity/status sensor |
| `jukebox_state` | Read-only robot media/voice status if privacy-safe |
| `map_combined_coverage`, `map_compressed_rgb`, `map_compressed_rgb_higher`, `map_integrated` | Alternative local map layers |
| `map_semantics`, `map_semantics_override`, `semantics_override`, `zones` | Room/zone semantics and map annotations |
| `schedule_event_previews` | Schedule preview diagnostics |
| `sink_summons` | Read-only sink event/history diagnostics |

The authoritative typed registry is
`custom_components/matic_robot/client/endpoints.py`; it also includes every
decoded property above and supplies kind/sensitivity metadata to polling,
inspection, snapshots, and documentation. Recording-related endpoints,
credentials, arbitrary names, and raw payload output are deliberately excluded.

## Verified writes

| Channel | Payloads | Current HA exposure |
| --- | --- | --- |
| `user_data` | Local client identity, timezone and connection kind | Internal session setup |
| `user_command` | Stop, pause, resume, dock | Vacuum actions and `send_command` |
| `user_command` | Full-floor/room coverage; vacuum, mop or both; quick/standard; ordered/unordered | Vacuum start/Area/segment cleaning; `matic_robot.clean`; saved plans |
| `child_lock_enabled_command` | Boolean | Child-lock switch |
| `petwaste_enabled_command` | Boolean | Pet-waste-avoidance switch |
| `voice_enabled_command` | Boolean | Voice-assistant switch |
| `deep_mop_override_setting_command` | Enable/disable | Deep-mop switch |
| `water_flow_override_command` | 0.5–2.0 in 0.1 steps | Water-flow number |

No new write is exposed from a guessed name, enum, or payload. It requires an
exact synthetic fixture, safe real-robot acceptance evidence, tests, and native
Home Assistant error handling.

## Version snapshots

- [v168.11](firmware-versions/v168.md) — core reads and the 40-name hash-only
  availability sweep live-verified 2026-07-20; writes remain untested.
- [Snapshot template](firmware-versions/template.md) — copy after each OTA.

The integration persists 52 safe snapshots, emits an event on a new version,
raises a Home Assistant Repair only for compatibility drift, and separates
endpoint availability changes from normal content changes. The Markdown ledger
remains the reviewed compatibility claim.
