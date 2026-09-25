# Managed cleaning across Home Assistant restarts

[Documentation](README.md) · [Managed-run contract](e2e-contract.md)

Managed plans save their progress so Home Assistant can reconnect to the same
robot mission after a restart. The run keeps its queue, settings, verified
results, and stop preference.

## What to expect

- Restarting Home Assistant or reloading an enabled integration preserves the
  checkpoint without sending Stop or marking the run finished.
- Startup shows `recovering` while checking the current mission and floor.
- When both match, the runner keeps its original `run_id` and continues observing
  the accepted mission without sending the cleaning command again.
- User Stop takes priority. A saved finish-current-room request remains in effect.
- If ownership cannot be established, the run becomes unverified. Previously
  verified results remain saved; remaining work needs a fresh start.

Removing the integration retires its saved queue but does not stop an already
running native mission. Use Stop first if you also want cleaning to end.

## What the checkpoint preserves

The resolved room queue, run ID, room settings, floor binding, current leg,
dispatch phase, verified results, stop intent, timing, pause/recharge state, and
bounded trigger labels are saved locally. Session identities and history keys
are stored as fingerprints. Checkpoints are excluded from entity snapshots.

Recovery retains the original completion and history-verification deadlines;
a restart does not give the run extra cleaning time. Already verified legs are
skipped. Older checkpoints retain their original mission boundaries.

## Interrupted dispatch or Stop

Mixed-setting missions save their generated session fingerprint before START.
If restart finds that same mission with its START/UPDATE sequence incomplete,
recovery saves a run-bound STOP intent and settles that mission. A saved
finish-current-room preference becomes an exact-session Stop in this case,
because the per-room settings update may not have reached the robot.

Recovery never replays START, UPDATE, or an ambiguous STOP. Changed, missing,
malformed, or unreadable session identity cannot authorize a command. If saving
the recovery Stop intent fails, ownership is released without sending Stop.

An accepted Stop keeps its run-bound settlement record across restart. The
runner resumes watching for the native mission to become inactive and settle
at the dock. A replacement command, expiry, or ownership mismatch retires it.

## When recovery cannot continue

- Acceptance without a saved identity, or no confirmed room-start checkpoint,
  leaves dispatch uncertain. Recovery does not repeat the command.
- If the mission ended or changed while Home Assistant was offline, native
  history can credit explicit completed-room results but cannot authorize the
  remaining queue. This also applies between legacy settings groups.
- If history verification had already begun, recovery resumes that observer
  with its original deadline; it cannot dispatch another leg.
- Missing floor evidence, malformed checkpoints, and old runs without checkpoints
  cannot resume cleaning. Previously cancelled runs are not resumed.
- If every requested room was already durably verified, recovery preserves completion.

Reconnection is bounded. Inconclusive recovery leaves unrelated native missions
alone and retains only the results it can verify.

## Release validation

Synthetic tests cover shutdown, restoration, same-mission reattachment, takeover,
stop races, and ambiguous dispatch. Follow [Contributing](../CONTRIBUTING.md#releasing)
for candidate installation and physical restart/reconnect acceptance.
