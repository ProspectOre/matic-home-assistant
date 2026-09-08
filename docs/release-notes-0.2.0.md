# 0.2.0

Adds firmware compatibility checks, room statistics, cleaning/firmware events,
a firmware update entity, and a Wi-Fi signal sensor. Connection recovery handles
robot-side stream resets, and sensitive live attributes stay out of Recorder.

## Upgrading from 0.1.x

- Numbered entity IDs migrate once to descriptive IDs where available. Update dashboards and automations that reference renamed entities.
- Replace `matic_robot.fetch_hermes_collection` with `matic_robot.inspect_hermes_endpoint`, and `collection` with `endpoint`. Remove `include_payload`, `payload_format`, and `max_bytes`; raw payload output was removed.
- Room lists, SSID, schedules, session details, plan history, and timezone remain live attributes but are no longer recorded. The Wi-Fi neighbor list was removed; plan details now use `active` and `preview` attributes.
- Per-room statistics are disabled by default. Enable them on the device page to record room history.
- Removing the integration also removes its stored firmware history.
