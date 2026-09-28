# 0.5.0 RC7 — Manual-run ownership migration

This release candidate fixes a migration edge case where an older tracked room
clean could share a saved plan's private rotation and cadence records.

- Rotation rows move to the private manual-run namespace only when their stored
  run ID matches the migrated manual run. Other saved-plan history is retained.
- When a saved plan uses the legacy `quick_clean` ID, its active private cadence
  counts are preserved but marked unverified. The affected plan stays blocked
  until the owner resets each affected mopping or coverage interval in Map
  Studio. The old aggregate has no per-run provenance to determine whether a
  tracked room clean contributed to it.
- Shared room schedules and cleaning history are unchanged. The migration does
  not reconstruct progress from historical totals or guess which work counted.

Install this prerelease through HACS beta versions and restart Home Assistant.
If an affected saved plan contains private room schedules, review the room
schedule explanation and reset the named interval before running that plan.
This is a prerelease; automated checks and physical acceptance remain separate
gates.
