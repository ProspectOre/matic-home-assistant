# 0.4.4 — Cleaning restart recovery

- Home Assistant shutdown no longer sends Stop or labels an active managed
  cleaning run as failed just because its automation task was cancelled.
- After restart, the integration reconnects to the same verified native mission
  and continues tracking the original plan without repeating its clean command.
- User Stop and finish-current-room requests survive reconnect. Already verified
  room completions are retained without duplicate credit.
- Recovery reports uncertainty instead of replaying a mission when the native
  identity or floor no longer matches, or command acceptance cannot be proven.

Includes the Bluetooth stale-bond recovery introduced in the preceding beta.
See [restart recovery](restart-recovery.md) for ownership and offline limits.
