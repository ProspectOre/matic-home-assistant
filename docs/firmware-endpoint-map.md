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
| `kabuki_state` | Battery, state/error codes (including typed dust-bag full/missing values), activity, firmware fallback, channel/profile, current/previous area, Cues voice/gesture lifecycle and following presence | Vacuum; activity, battery, current-area and Cues lifecycle sensors; read-only bag observation in `MaticGetOperations`; Cues event entity and bus event; attributes. Public bag entities remain withheld pending real-world verification. |
| `coverage_plan` | Mission, partition, named room IDs and geometry | Rooms sensor, map camera, vacuum segments/Areas, cleaning target |
| `latest_pose` | Robot position and heading across both verified wire layouts; payload-free vector paths in endpoint inspection | Map camera |
| `approximate_trajectory` | Mission-correlated, finite 2D route updates and mission-scoped clear markers | Typed client stream; no HA entity or map overlay yet |
| `flythrough` | Mission-correlated native 3D camera locations and look-at targets | Typed client snapshot; no HA entity or browser response yet |
| `current_version` | Software/profile, protocol version, feature flag | Software and protocol sensors; software attributes |
| `update_config` | Update channel | Update-channel sensor |
| `update_state` | Update lifecycle | Update-state sensor and update-available binary sensor |
| `wifi_status` | State, SSID, signal and visible/known networks | Wi-Fi state/signal/count summary; identities excluded from attributes |
| `time_zone` | Robot timezone | Internal decoded telemetry; excluded from recorder attributes |
| `schedule_events` | Local schedules, weekdays, time, rooms, ordering and enabled state | Scheduled-cleanings count; definitions excluded from attributes |
| `coverage_session_history` | Local session count and native latest-session summary | Local-cleaning-session count; newer stale-firmware sessions are reconstructed from verified HA cleaning/area history |
| `coverage_session_thumbnails` | Validated private WebP session maps joined by opaque history key | Typed client snapshot only; no HA state, cache or media endpoint |
| `recap_history` | Monthly sweep/mop area and duration, session count and optional favorite-room label | Typed client snapshot only; no HA state or recorder data |
| `map_semantics`, `map_semantics_override` | Mission-correlated 32 × 32 native semantic grids aligned by SLAM page key | Typed client tiles only; no HA entity or map overlay yet |
| `dock_detections` | Collection count | Dock-detections sensor |
| `sink_summon_locations` | Collection count | Sink-summon-locations sensor |
| `coverage_time` | Accumulated coverage seconds | Coverage-time sensor |
| `child_lock_enabled_state` | Child-lock state | Child-lock switch |
| `petwaste_enabled_state` | Pet-waste avoidance state | Pet-waste-avoidance switch |
| `voice_enabled_state` | Matic Cues state | Cues switch |
| `matter_pairing_state` | Pairing-mode presence | Matter-pairing binary sensor |
| `deep_mop_override_setting_state` | Double-pass mop state | Deep-mop switch |
| `water_flow_override_state` | Water-flow multiplier | Water-flow number |
| `user_tunnel_ssh_permission` | Robot SSH permission | Diagnostic binary sensor |
| `uploader_config_state` | Robot diagnostic-upload opt-in | Diagnostic-upload binary sensor |
| `active_session_key` | Active cleaning-session presence | Active-cleaning-session binary sensor |

## Allowlisted exploratory reads

These are bounded, payload-free reads through `inspect_hermes_endpoint` and the
automatic/manual `firmware_snapshot` workflow. The snapshot records hashes and
bounded value-free wire shapes where the payload is a small protobuf message.
Payloads are not decoded into entities unless listed above. “Candidate” is a
research direction, not a promise that the field exists or is safe on every
firmware.

| Collections | Possible safe HA use after evidence |
| --- | --- |
| `planned_path` | Planned-path overlay or path-status diagnostics |
| `coverage_corridor`, `coverage_marker` | Coverage/map annotations |
| `displayed_mission`, `labeled_missions` | Mission identity/status sensor |
| `jukebox_state` | Read-only robot media/voice status if privacy-safe |
| `map_combined_coverage`, `map_compressed_rgb`, `map_compressed_rgb_higher`, `map_integrated` | Alternative local map layers |
| `semantics_override`, `zones` | Room/zone semantics and map annotations |
| `schedule_event_previews` | Schedule preview diagnostics |
| `sink_summons` | Read-only sink event/history diagnostics |

The authoritative Home Assistant inspection registry is
`custom_components/matic_robot/client/endpoints.py`; it also includes every
coordinator-polled property above and supplies kind/sensitivity metadata to
polling, inspection, snapshots, and documentation. Privacy-sensitive client-only
decoders are not automatically promoted into inspection or entity state. Recording-related endpoints,
credentials, arbitrary names, and raw payload output are deliberately excluded.

## Verified writes

| Channel | Payloads | Current HA exposure |
| --- | --- | --- |
| `user_data` | Local client identity, timezone and connection kind | Internal session setup |
| `user_command` | Stop, pause, resume, dock | Vacuum actions and `send_command` |
| `user_command` | Full-floor/room coverage and official drawn-circle custom coverage; vacuum, mop or both; Quick/Optimal/Heavy Duty; ordered/unordered | Vacuum start/Area/segment cleaning; `matic_robot.clean`; `matic_robot.clean_area`; saved plans and areas |
| `child_lock_enabled_command` | Boolean | Child-lock switch |
| `petwaste_enabled_command` | Boolean | Pet-waste-avoidance switch |
| `voice_enabled_command` | Boolean | Cues switch |
| `deep_mop_override_setting_command` | Enable/disable | Deep-mop switch |
| `water_flow_override_command` | 0.5–2.0 in 0.1 steps | Water-flow number |

No new write is exposed from a guessed name, enum, or payload. It requires an
exact synthetic fixture, safe real-robot acceptance evidence, tests, and native
Home Assistant error handling.

## Version snapshots

- [v168.11](firmware-versions/v168.md) — core reads and the 40-name hash-only
  availability sweep live-verified 2026-07-20; selected stop, dock, and room-plan
  control paths were later exercised, while the complete write matrix remains
  pending.
- [Snapshot template](firmware-versions/template.md) — copy after each OTA.

The integration persists 52 safe snapshots, emits an event on a new version,
then emits a silent analysis event after the automatic comparison. It separates
endpoint availability changes, normal content changes, and newly added wire
shapes. Only availability/transport drift creates a Home Assistant Repair;
structural candidates remain diagnostic until reviewed. The Markdown ledger
remains the reviewed compatibility claim.
