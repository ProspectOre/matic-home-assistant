# Simulated robot test harness

[Documentation](README.md) · [Plan run contract](e2e-contract.md) · [Contributing](../CONTRIBUTING.md)

`tests/e2e` runs Home Assistant Core, the config entry, its coordinator and
platforms, and the real Hermes client against a simulated robot. Nothing
between Home Assistant and the network is mocked: the client dials the robot's
mDNS name, completes TLS, pins the certificate, authenticates, and speaks gRPC
over HTTP/2 to `tests/e2e/hermes_sim.py`.

The tests run in the normal `pytest` command, so the Test workflow's `ci` job
covers them on hosted `ubuntu-latest`.

## What is simulated

| Part | Simulator behavior |
| --- | --- |
| TLS identity | A CA and `robot_server` leaf with Matic's DirectoryName SAN, generated per test. The test points `MATIC_INTERMEDIATE_CA` at that CA; pinning code is unchanged. |
| Name resolution | The robot's `.local` name resolves to loopback. |
| `HermesDiscoveryRPC` | `GetBotInfo` returns the simulated identity. |
| `HermesAuth` | `AuthToken` issues a credential only while `pairing_open` is set. |
| `Hermes` | `Handshake` and `FetchCollection` require a credential the robot issued. Properties answer snapshots; tracked subscriptions wait for each sequence acknowledgment and then push changes. Unserved names return `UNIMPLEMENTED`. |
| `user_command` | STOP, PAUSE, RESUME and DOCK are matched against the captured official-app bytes, which the simulator holds separately from the integration's encoders, and move the robot between phases. A coverage START or UPDATE starts a native task for the commanded rooms. |
| Robot state | `kabuki_state` for docked, charging, cleaning, paused, returning, stopped, low-charge recharge and a blocking fault, using state-code sets seen on real robots, with battery, errors, software version and current area. |
| Floor and task | `coverage_plan` serves the floor and retains the commanded goals; `active_session_key` carries the task's session; `coverage_session_history` gets a record with per-room results when the task ends. One live photographic and one structural map page confirm the floor. |

Time does not pass on its own. A test moves the robot with scripted steps such
as `start_cleaning`, `finish_room`, `finish_session`, `arrive_at_dock`,
`low_charge_recharge`, `fault`, `app_takes_over` and `offline`, then runs a
coordinator poll, so results do not depend on timing. History timestamps use
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
  again, and a restart after the task ended (unverified).
- An unreachable robot makes entities unavailable and they recover.
- A revoked credential starts reauthentication.
- Client level: pairing window, unknown credentials, fingerprint and serial
  pinning, snapshot, tracked and pushed collections, unsupported endpoints.

## Not covered yet

Saved plans with mixed per-room settings, custom areas, sink trips, delayed
history reconciliation, and Matic Map in a browser against the simulator. The
scripted check on an installed host is a separate milestone item.

## What this proves

Passing here is simulated evidence. It shows the integration and client agree
with the simulator, and the simulator encodes what was observed from real
robots. It does not replace installing the candidate on a Home Assistant host
or physical acceptance on a robot, and release notes must not present it as
either.
