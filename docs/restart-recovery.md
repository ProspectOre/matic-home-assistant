# Managed cleaning across Home Assistant restarts

Home Assistant shutdown is an observer lifecycle event, not a robot Stop.
Cancellation while HA is stopping must not send Stop or publish a terminal
managed-run outcome. Explicit user Stop, integration unload, replacement
commands, and real failures retain their separate cancellation behavior.

## Durable ownership

Managed room plans checkpoint their resolved queue, run ID, settings, floor
binding, current leg, dispatch phase, verified room credits, and stop intent.
Native session identities and history keys remain opaque in memory; only
fingerprints are stored locally. Checkpoints are excluded from entity snapshots.

The checkpoint is written before dispatch and after accepted identity evidence.
Durable runs do not prefetch a different-settings mission while verifying the
previous leg. Same-settings rooms still share one native ordered mission.

Startup reports `recovering`, waits for current floor/session evidence, and
rejoins the normal executor only when the native identity fingerprint and floor
binding match. It retains the original run ID and does not resend the accepted
clean command. Verified prior legs are skipped; the remaining queue continues
through the existing completion and command-ownership guards. User Stop wins
over recovery; a saved finish-current-room request is not cleared by reconnect.

## Deliberate uncertainty boundaries

- A crash between native command acceptance and the identity checkpoint is
  ambiguous. Recovery does not guess whether dispatch succeeded or replay it.
- If the native mission ended or changed while HA was offline, native-history
  import can still credit its explicit room results. The managed run remains
  unverified and its remaining queue is not automatically dispatched: history
  alone does not establish continuous ownership of that queue.
- This also applies between different-settings legs, even when the prior leg
  was credited before shutdown and the next leg is known to be undispatched.
  Verified completion proves prior work, not continued authority to start new
  motion after an unobserved interval. Remaining work needs a fresh user start.
- If all requested rooms were already durably verified before shutdown,
  recovery preserves completion even if the final run record was not yet saved.
- Missing identity/history, stale floor evidence, malformed checkpoints, and
  old runs without checkpoints cannot authorize recovered motion.
- Reconnection is bounded. Inconclusive recovery retires the managed record
  as unverified, not completed, without stopping an unrelated native mission.

These boundaries intentionally prefer truthful uncertainty over duplicate
cleaning or invented completion. Previously cancelled runs are not resurrected.

## Acceptance

Synthetic tests cover actual HA shutdown, no shutdown Stop/terminal event,
durable restoration, same-mission reattachment, takeover, stop races, and
ambiguous dispatch. Deployment and physical acceptance are separate gates:
install a reviewed candidate only while idle, then use an explicitly authorized
bounded clean/restart/reconnect exercise to verify unchanged native mission,
accurate status, remaining-room progress, and final stop/dock behavior.
