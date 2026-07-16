# Recording-related protocol notes

These notes document recording-related semantics observed in the robot's local
protocol. They are not part of the Matic for Home Assistant 0.1 entity or action
contract. The integration does not request these properties or collections,
publish to these command channels, fetch or cache clip media, or send vendor
review decisions.

The integration's **Map** camera is separate from these surfaces. It renders
room geometry, labels, and robot pose locally in Home Assistant and contains no
optical camera frames. No live video protocol or stream has been verified.

## Why recording controls are not included

Camera and microphone content can reveal people, conversations, belongings,
and the interior of a home. The observed recording operations are primarily
support workflows rather than dependable local robot-control primitives.
Sending a clip to a vendor has an external effect, while a request to discard
or delete a clip may be irreversible. Home Assistant also cannot verify how a
robot or external service handles or retains data after either decision.

The 0.1 contract therefore contains no recording entities, services, media
provider, raw collection access, or automatable consent decision.

## Observed state and collections

The following local Hermes names describe recording-related state. They are
listed for protocol clarity and are not available through the integration:

- `auto_record_voice_enabled_state`: whether automatic recording associated
  with voice interactions is enabled.
- `rolling_recordings_config_state`: rolling recording enabled or disabled,
  with an optional confirmation-for-each-clip preference.
- `user_audio_recording_state`: microphone diagnostic state with observed
  `idle`, `ambient`, `direction_of_arrival`, and `wake_word` modes.
- `scratch_recordings`: pending recording metadata. Observed fields include a
  robot-assigned unsigned identifier, user or robot trigger, optional robot
  reason, start time, duration, and whether video exists.
- `recording_thumbnails`: thumbnail objects associated with completed clips.
- `recording_videos`: completed video objects observed in MP4 form. A completed
  object collection is not a live video stream.

Observed robot-trigger reasons include brush-roll jams, docking failures,
critical stuck events, duct clogs, network commands, new dock detections,
missing or jammed brush and mop rolls, stale dock removal, pet-waste detection,
a dislodged sweeper, mirror or cloth detection, mopping or vacuuming start,
mopping wheel slip, an edge-cleaning emergency stop, incorrect map semantics or
toekick detection, and voice commands. Firmware may add, remove, or reinterpret
values.

## Observed command channels

The following authenticated Hermes channels have recording-related semantics.
The integration does not publish to them:

- `auto_record_voice_enabled_command`: change the automatic voice-recording
  preference.
- `toggle_rolling_recordings`: enable or disable rolling recording and set the
  per-clip confirmation preference.
- `recording_command`: start or stop a manual support recording, or request that
  the current rolling buffer become an error clip.
- `user_audio_recording_command`: select an observed microphone diagnostic
  mode.
- `recording_upload_confirmation`: submit a robot-assigned recording identifier
  with either a vendor support-sharing decision or a request for
  discard/deletion.

The support-sharing decision is externally consequential and is never sent by
the integration. The discard/deletion decision describes a request; these notes
do not claim permanent deletion from the robot, caches, backups, or an external
service.

No captured identifiers or serialized command payload bytes are included here.
For current vendor behavior, consent, and retention terms, consult Matic's
[privacy policy](https://maticrobots.com/privacy-policy),
[recording support article](https://support.maticrobots.com/how-to-take-a-recording-from-matics-point-of-view),
and [release notes](https://maticrobots.com/blog/matic-release-notes).
