# Protocol endpoint reference

[Entities](entities.md) · [Actions](actions.md) · [Firmware compatibility](firmware-compatibility.md)

Hermes is Matic's local gRPC protocol. The registry in
[endpoints.py](../custom_components/matic_robot/client/endpoints.py) defines the
40 non-credential endpoints available to inspection and firmware snapshots.

## gRPC methods

| Method | Use |
| --- | --- |
| `GetBotInfo` | Robot and hardware metadata |
| `AuthToken` | Issue a credential during Bluetooth pairing |
| `Handshake` | Authenticate the local session |
| `FetchCollection` | Read properties and collection streams |
| `SendToChannel` | Send session data, settings, and commands |

## Decoded reads

| Endpoint | Home Assistant use |
| --- | --- |
| `kabuki_state` | State, battery, errors, current area, Cues lifecycle, and read-only bag observations |
| `coverage_plan` | Rooms, geometry, cleaning targets, and floor identity |
| `latest_pose` | Robot position and heading on the map |
| `map_compressed_rgb`, `map_integrated` | Local photographic/structural map layers |
| `current_version`, `update_config`, `update_state` | Software/protocol versions, update channel and state |
| `wifi_status` | Connection and signal; SSID is a live, unrecorded attribute |
| `time_zone` | Robot timezone |
| `schedule_events` | Schedule count and live, unrecorded definitions |
| `coverage_session_history` | Native session and per-mode room results |
| `dock_detections`, `sink_summon_locations` | Location counts |
| `coverage_time` | Accumulated coverage seconds |
| `child_lock_enabled_state`, `petwaste_enabled_state` | Child lock and pet-waste avoidance |
| `voice_enabled_state` | Matic Cues setting |
| `deep_mop_override_setting_state`, `water_flow_override_state` | Double-pass mopping and water flow |
| `matter_pairing_state` | Matter pairing presence |
| `user_tunnel_ssh_permission`, `uploader_config_state` | Diagnostic settings |
| `active_session_key` | Active native session identity |

Client-only decoders also handle `approximate_trajectory`, `flythrough`,
`coverage_session_thumbnails`, `recap_history`, `map_semantics`, and
`map_semantics_override`. These do not add entities or browser overlays.

## Other inspection endpoints

The registry includes `planned_path`, `coverage_corridor`, `coverage_marker`,
`displayed_mission`, `labeled_missions`, `jukebox_state`,
`map_combined_coverage`, `map_compressed_rgb_higher`, `semantics_override`,
`zones`, `schedule_event_previews`, and `sink_summons`. Inspection returns
fingerprints and value-free wire shapes; it does not decode these into entities.

## Writes

| Channel | Use |
| --- | --- |
| `user_data` | Local client session setup |
| `user_command` | Stop, pause, resume, dock, and floor/room/custom-area cleaning |
| `child_lock_enabled_command` | Child lock |
| `petwaste_enabled_command` | Pet-waste avoidance |
| `voice_enabled_command` | Matic Cues |
| `deep_mop_override_setting_command` | Double-pass mopping |
| `water_flow_override_command` | Water flow, 0.5–2.0 in 0.1 steps |

New commands follow [Contributing](../CONTRIBUTING.md#changes-and-pull-requests).
[Recording endpoints](recording-protocol.md) are outside the integration.
