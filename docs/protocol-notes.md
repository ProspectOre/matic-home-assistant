# Protocol notes

[Robot protocol map](firmware-endpoint-map.md) · [Working alongside the Matic app](coexistence.md) ·
[Cleaning results](native-cleaning-results.md)

Wire fields the integration decodes, and where each was learned. Field numbers
come from the Matic app's own decoder or from recordings of the app, never from
guesses. They were traced offline: recorded data was replayed through the
app's bindings, and no robot command was sent. Recordings, app binaries and
anything that names a home stay out of this repository.

## Sources

| Topic | Traced in | SHA-256 |
| --- | --- | --- |
| Cleaning history | Matic app 1.182.1 (build 106), robot on firmware v181.10, 2026-11-01 | Base APK `dfb7e989975a6e08eebad62796a32def52bd5e525c8afa1bc8e287ae1eb5a0a5`, native library `d3c4358caad2819810214a325902bbe205a430777273575ac204ae8f529be01e` |
| Stop reason titles | Matic app 1.183.1 (build 108) | Base APK `15f1ec48…c979fc546`, arm64 split `e7907cb2…dab2e43` |
| Schedules | Android arm64 `libmegazord.so`, 2026-11-01 | `150e992f40daf46f204f7de349a5ba154fa2c524f6533fdf330b1fa6432840e9` |
| Cleaning settings | Matic app 1.175.1 against firmware v178.8 | Not recorded |

## Cleaning history (`coverage_session_history`)

Twenty history events from the app matched the decoder on every field below.
[history_semantics.py](../custom_components/matic_robot/client/history_semantics.py)
holds the decoder.

| Meaning | Path | Values |
| --- | --- | --- |
| Mission | Root `1`, nested `2` (`fixed32`) | |
| Floor (partition) | Log `2`, repeated `1`, initial event `2`, start goals `1`, repeated goal `2` (or `1`), goal metadata `7`, envelope `1/1/2`, then `1` and `2` (`fixed64` high and low) | The path `2/1/10/2/1/1` holds related data, not the floor |
| Result per mode | Root `5`, `11`, repeated `1`, map value `2`, repeated `2`, mode-map value `2`, status `5` | Mode key `1`: `0` vacuum, `1` mop. Status: `0` not started, `1` incomplete, `2` completed |
| Why it stopped | Root `5`, `10`: `5/1` or `5/2` finished, `8/1` cancelled by the user | No stop reason reads as cancelled by the robot |
| Who started it | Log `2/1/2/3`: user variant `2/1/1` is the app; `2` to `6` are Atrium, Button, Matter, Voice and Gesture | A schedule's label is UTF-8 at `3/2` |

- A completed vacuum with an unattempted or partial mop is incomplete overall.
- When the per-mode result is present, the older status fields (`5/5` and
  `5/6/1/2/5`) do not change the app's answer and are ignored.
- Cancelling keeps the work already completed.
- A record without a mission, a floor or a start reason is rejected.
- The app titles a finished clean whose room was never attempted "Area
  inaccessible", a clean the robot cancelled "Stopped unexpectedly" and one the
  user cancelled "Cancelled". The integration reads the first as
  [a room the robot could not reach](native-cleaning-results.md#rooms-the-robot-could-not-reach).

## Robot errors (`kabuki_state`)

Packed wire error `220` (`12 02 dc 01`) is `SolventUnavailable` in the app.
An enum position alone is not proof of a code's meaning: each named error
needs a recording or the app's own text.

## Schedules (`schedule_events`)

| Wire field | Meaning | Enabled reads as |
| --- | --- | --- |
| `8`, empty message | Enabled | true |
| `9`, empty message | Disabled | false |
| `10`, empty message | Suggested | unknown |

- Field `11` is unrelated. Top-level field `3` is an older enabled flag, used
  only when none of the three markers is present. Missing, conflicting or
  malformed values stay unknown.
- Field `7` holds the rooms: repeated field `1` is the ordered list and
  repeated field `2` the unordered one. Each room is at `7/3/3` within its
  block. The decoder reads both lists, keeps each room once in first-seen
  order, and leaves the order unknown when the lists are missing or mixed.
- Weekdays run Monday to Sunday.
- The app acknowledges every schedule record on the stream before the robot
  sends the next. A reader that closes its side without acknowledging sees
  only the first schedule, which was the cause of
  [#384](https://github.com/ProspectOre/matic-home-assistant/issues/384).
- Parsing is bounded: 64 KiB per schedule, 1,024 fields per goal list, 16,384
  fields across all rooms and 256 distinct rooms.

## Cleaning settings (coverage goals)

- Vacuum coverage applies to vacuum goals only: Quick sends `2`, Optimal `1`
  and Heavy duty `0`. Mop goals always send Standard (`1`), as the app does.
- The double-pass mopping switch is on with field `2`'s empty message and off
  with field `1`'s.
- App 1.181 renamed the VACUUM mode to SWEEP; values written by either side
  read the same.

After sending settings for rooms that differ, the integration reads the
robot's goals back within 8 seconds and accepts only these differences:

- Mop behavior `3` may be missing from a mop-enabled room when the other three
  mop behaviors are each present once at the requested setting.
- A Heavy duty vacuum group may come back as setting `3` instead of `0`.
- With double-pass mopping on, a complete Standard mop group may come back as
  setting `3`. Double-pass must read as on both before and after the goals are
  read.

Anything else fails: a partly rewritten group, an extra or repeated goal, mop
setting `4`, or any room, floor, mode or behavior that doesn't match. A
readback that passes shows what the robot holds; it never counts as a
completed clean. With debug logging on for
`custom_components.matic_robot.client.api`, a timeout logs the stage it
reached and up to 32 missing or unexpected goals as
`(room_ordinal, setting, floor, mode, behavior, count)`, without room names
or IDs.

## Commands

The robot does not acknowledge user commands, so the integration confirms
each one from the state it reads back. A new command needs the exact bytes the
app sends, in a synthetic fixture, and a successful try on a robot
([Contributing](../CONTRIBUTING.md#changes-and-pull-requests)).
