# Restart recovery

[Troubleshooting](troubleshooting.md) · [How a plan runs](cleaning.md#how-a-plan-runs) ·
[Plan run contract](e2e-contract.md)

A running plan saves its progress so Home Assistant can rejoin the same robot
mission after a restart. The run keeps its queue, settings, confirmed results
and stop preference. Recovery never sends a cleaning command a second time.

## How a plan is split

A plan runs as one or more robot missions, called legs. `plan_legs` and
`entry_mission_boundaries` in
[plan_model.py](../custom_components/matic_robot/plan_model.py) decide them:

- Consecutive rooms share one mission, each room with its own cleaning mode and
  vacuum coverage.
- Each custom area is its own mission. The robot heads for its dock afterwards,
  and the next leg starts once the area's mission has ended and the robot is
  returning, idle or docked.
- Smart Stop (finish current room) takes the waiting rooms out of the robot's
  queue, and the robot ends the mission after its current room. A run an
  earlier version saved with one mission per room keeps that split when it
  recovers.

A room leg is one start followed by a settings update per room. The update is
sent only to the mission the run generated, on the map it started with, while
the first room is cleaning. When a leg finishes, the run saves the next leg and
a handoff phase before it waits for the robot to settle, so a restart between
legs can resume the queue.

## What to expect

- Restarting Home Assistant or reloading an enabled integration preserves the
  checkpoint without sending Stop or marking the run finished.
- Startup shows `recovering` while checking the current mission and floor.
- When both match, the runner keeps its original `run_id` and continues observing
  the accepted mission without sending the cleaning command again.
- If Home Assistant stopped between legs, recovery checks that the robot's
  history is unchanged and that the previous mission is still the robot's own
  or has ended, waits for the robot to settle, then starts the next leg.
- User Stop takes priority. A saved finish-current-room request remains in
  effect; between legs it ends the run instead of starting the next leg.
- If ownership cannot be established, the run becomes unverified. Previously
  verified results remain saved; remaining work needs a fresh start.

Disabling or removing the integration retires its saved queue but does not stop
an already running native mission. Use Stop first if you also want cleaning to
end.

## What the checkpoint preserves

The resolved queue of rooms and custom areas in order, run ID, room settings,
floor binding, current leg (`leg_index`), finished areas (`finished_area_legs`),
dispatch or handoff phase, verified results, stop intent, timing,
pause/recharge state, and bounded trigger labels are saved locally. Session
identities and history keys, including the history seen at a handoff, are
stored as fingerprints. Checkpoints are excluded from entity snapshots.

Recovery retains the original completion and history-verification deadlines;
a restart does not give the run extra cleaning time. Already verified legs are
skipped. Older checkpoints retain their original mission boundaries.

## Interrupted dispatch or Stop

A room leg whose rooms use different settings saves its generated session
fingerprint before START. If restart finds that same mission with its
START/UPDATE sequence incomplete, recovery saves a run-bound STOP intent and
settles that mission. A saved
finish-current-room preference becomes an exact-session Stop in this case,
because the per-room settings update may not have reached the robot.

Recovery never replays START, UPDATE, or an ambiguous STOP. Changed, missing,
malformed, or unreadable session identity cannot authorize a command, and
cleanup stops only the mission the run owns, never one that replaced it. If
saving the recovery Stop intent fails, ownership is released without sending
Stop.

An accepted Stop keeps its run-bound settlement record across restart. The
runner resumes watching for the native mission to become inactive and settle
at the dock. A replacement command, expiry, or ownership mismatch retires it.

## When recovery cannot continue

- Acceptance without a saved identity, or no confirmed room-start checkpoint,
  leaves dispatch uncertain. Recovery does not repeat the command.
- If the mission ended or changed while Home Assistant was offline, native
  history can credit explicit completed-room results but cannot authorize the
  remaining queue.
- Between legs, the next leg starts only if the robot's history still matches
  the fingerprint saved at the handoff. A handoff without that fingerprint
  (history was unreadable, or the checkpoint predates it) cannot continue; nor
  can a robot that does not settle within the bounded 12-minute handoff wait.
- If history verification had already begun, recovery resumes that observer
  with its original deadline; it cannot dispatch another leg.
- Missing floor evidence, malformed checkpoints, and old runs without checkpoints
  cannot resume cleaning. Previously cancelled runs are not resumed.
- In a plan without custom areas, if every room was already durably verified,
  recovery preserves completion.
- A custom area rejoins only its own still-running mission. Its credit comes
  from the integration's own tracking of that mission, not the robot's history,
  so an area whose mission ended while Home Assistant was offline leaves the
  run unverified, and the remaining queue needs a fresh start.

Reconnection is bounded: recovery reads the robot's mission and floor up to 60
times, two seconds apart. Inconclusive recovery leaves unrelated native missions
alone and retains only the results it can verify.
