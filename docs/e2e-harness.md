# Simulated robot test harness

[Documentation](README.md) · [Plan run contract](e2e-contract.md) · [Contributing](../CONTRIBUTING.md)

`tests/e2e` runs Home Assistant Core, the config entry, its coordinator and
platforms, and the real Hermes client against a simulated robot. Nothing
between Home Assistant and the network is mocked: the client dials the robot's
mDNS name, completes TLS, pins the certificate, authenticates, and speaks gRPC
over HTTP/2 to `tests/e2e/hermes_sim.py`.

The tests run in the normal `pytest` command, so the Test workflow's `ci` job
covers them on hosted `ubuntu-latest`.

`tests/live` puts Matic Map in front of the same simulator. `server.py` writes
a throwaway, already onboarded Home Assistant configuration with the robot
paired, runs Home Assistant Core and its frontend in-process on 127.0.0.1:8123,
and serves a control endpoint on 8124 that moves the robot. The Test
workflow's `live` job runs `npx playwright test --config
playwright.live.config.mjs` against it; `ci` requires both jobs. Locally, run
the same command after `npm ci` and `pip install -e '.[test]'`.

## What is simulated

| Part | Simulator behavior |
| --- | --- |
| TLS identity | A CA and `robot_server` leaf with Matic's DirectoryName SAN, generated per test. The test points `MATIC_INTERMEDIATE_CA` at that CA; pinning code is unchanged. |
| Name resolution | The robot's `.local` name resolves to loopback. |
| `HermesDiscoveryRPC` | `GetBotInfo` returns the simulated identity. |
| `HermesAuth` | `AuthToken` issues a credential only while `pairing_open` is set. |
| `Hermes` | `Handshake` and `FetchCollection` require a credential the robot issued. Properties answer snapshots; tracked subscriptions wait for each sequence acknowledgment and then push changes. Unserved names return `UNIMPLEMENTED`. |
| `user_command` | STOP, PAUSE, RESUME and DOCK are matched against the captured official-app bytes, which the simulator holds separately from the integration's encoders, and move the robot between phases. A coverage START starts a native task; an UPDATE with the task's session ID keeps finished rooms and replaces the rest. A NavigateTo with a room goal or a sink posture moves the robot (see below). |
| Robot state | `kabuki_state` for docked, charging, cleaning, paused, returning, stopped, low-charge recharge and a blocking fault, using state-code sets seen on real robots, with battery, errors, software version and current area. |
| Floor and task | `coverage_plan` serves the floor and retains the commanded goals as room visits, so a room cleaned again appears twice; `active_session_key` carries the task's session; `coverage_session_history` gets a record with per-room, per-mode results when the task ends. One live photographic and one structural map page confirm the floor. `sink_summon_locations` holds a sink posture once a test saves one. |
| Navigation | The robot's state codes while driving somewhere are not recorded, so it arrives at once: ready in the room without a task, paused with one. A sink trip waits until the `refilled` step, then returns. |

Tests move the robot with explicit scripted steps such
as `start_cleaning`, `finish_room`, `finish_session`, `arrive_at_dock`,
`low_charge_recharge`, `fault`, `app_takes_over`, `refilled` and `offline`,
then await the integration's accepted state before advancing. History timestamps use
the wall clock because the integration binds a record to the dispatch time.
A few tests shorten a wait constant (the dock-after-stop poll, the history
window) rather than wait minutes; the logic is unchanged.

## Covered today

- Setup reads identity, state and firmware version, registers the device and
  unloads cleanly.
- A clean started outside Home Assistant is paused, resumed and sent home; a
  held task gets STOP, then DOCK once the stop settles.
- Low-charge recharge and resume.
- Robot errors appear only after the confirmation poll and clear again.
- Managed plan runs (`clean_room_sequence`, Kitchen then Study), following the
  [plan run contract](e2e-contract.md): all rooms verified from native
  history, a session that ends after one room (partial credit), return home
  during a run (cancelled, STOP then DOCK, then `stopped_docked`), the app
  taking over (no credit, no STOP), recharge and resume, a robot fault
  (failed), a restart that rejoins the same native task without dispatching
  again, and a restart after the task ended (unverified). Rooms with their
  own mode and strength send only those goals and get per-mode history.
- Changing a running plan: skip the next room, bring the last room forward,
  clean a finished room again, and refusing to skip the only room left.
- Go to room from the dock and during a plan (the run keeps its task and
  finishes after Resume), and an unknown room refused before anything is sent.
- A sink trip waits for the refill and docks; without a saved sink it is
  refused.
- An occupancy-aware saved plan holds a room whose sensor is on.
- A full bag raises a Repair after the confirmation poll and clears it when
  the error goes.
- Custom-area geometry reaches the native command. Saved area plans and a
  room → area → room plan preserve mission order, dock handoffs and separate
  room and area history; unknown areas are refused before dispatch.
- Native schedules expose all three cleaning modes, ordered and unordered
  rooms, disabled entries and local-time occurrences through the HA calendar.
  A new native scheduled session takes over without a managed STOP.
- The Wi-Fi survey switch starts a scheduled scan, records signal strength at
  a fresh pose without a network name, stops sampling, and clears saved cells.
- Grouped native history held past verification reconciles only the original
  session's observed rooms. Wrong-session evidence expires without credit or
  redispatch, and late credit preserves the original terminal run outcome.
- Camera and patrol calls cross the real service, client and image HTTP paths:
  arrival and capture freshness, wrong or unknown rooms, takeover, opt-in,
  cooldown, blocked-room manual snapshots, preview bytes, authentication and
  the 16-photo memory limit.
- An unreachable robot makes entities unavailable and they recover.
- A revoked credential starts reauthentication.
- Client level: pairing window, unknown credentials, fingerprint and serial
  pinning, snapshot, tracked and pushed collections, unsupported endpoints.

- In a browser against Home Assistant: choosing Kitchen and Study sends one
  coverage command, the panel follows the robot and returns to ready at the
  dock. Open history reflects delayed completion without a page reload.
  Go to room and Map-started Skip preserve their command and queue contracts.
  Drawing, saving and cleaning a custom area reaches the native area mission;
  history shows the next native schedule; the Wi-Fi layer reads a survey cell
  and responds to the survey switch.

## Not covered yet

The scripted check on an installed host, real-store upgrade and rollback, and
physical robot acceptance remain separate milestones. New camera capabilities
such as aimed views or image analysis need their own implementation and tests.

## What this proves

Passing here is simulated evidence. It shows the integration and client agree
with the simulator, and the simulator encodes what was observed from real
robots. It does not replace installing the candidate on a Home Assistant host
or physical acceptance on a robot, and release notes must not present it as
either.
