# Recording protocol reference

[Privacy](privacy.md) · [Protocol endpoints](firmware-endpoint-map.md)

The following Hermes names were observed in the robot protocol but are not used
by this integration. Map cameras use room geometry or accumulated SLAM data;
they do not provide recordings, clips, or live video.

## State and collections

| Name | Observed purpose |
| --- | --- |
| `auto_record_voice_enabled_state` | Automatic voice-recording preference |
| `rolling_recordings_config_state` | Rolling recording and per-clip confirmation preferences |
| `user_audio_recording_state` | Microphone diagnostics: idle, ambient, direction of arrival, or wake word |
| `scratch_recordings` | Pending clip metadata: identifier, trigger/reason, time, duration, and video presence |
| `recording_thumbnails` | Completed-clip thumbnails |
| `recording_videos` | Completed video objects |

## Command channels

| Name | Observed purpose |
| --- | --- |
| `auto_record_voice_enabled_command` | Change automatic voice recording |
| `toggle_rolling_recordings` | Change rolling recording and confirmation preferences |
| `recording_command` | Start/stop a support recording or capture the rolling buffer |
| `user_audio_recording_command` | Select a microphone diagnostic mode |
| `recording_upload_confirmation` | Request support sharing or discard/deletion of a clip |

For recording controls and retention terms, use Matic's
[recording guide](https://support.maticrobots.com/how-to-take-a-recording-from-matics-point-of-view)
and [privacy policy](https://maticrobots.com/privacy-policy).
