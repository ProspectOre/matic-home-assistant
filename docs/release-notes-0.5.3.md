# Matic 0.5.3 RC3

Saved plans can start with old, unreadable entries in robot history. Home
Assistant waits for the result from the clean it started, including when the
robot delivers history in batches or retains a large custom-area result. Rooms
stay due when the robot cannot confirm they were cleaned.

An accepted saved plan keeps running if the caller disconnects. You can still
stop it from Home Assistant.

Between parts of a saved plan, Home Assistant checks whether the robot has
moved on to another clean. Older results can stay unreadable during this
check. If the robot restarts after the check begins, the remaining rooms
stay due when Home Assistant detects the change. After a Home Assistant
restart, it can recover a clean it already started even if older results
are unreadable.

If you switch back from the 0.6 beta, the integration preserves the newer map
history cache and can start with a temporary cache.

Thanks to [parkerbxyz](https://github.com/parkerbxyz) for the fix in
[#403](https://github.com/ProspectOre/matic-home-assistant/pull/403) and the beta
testing and follow-up reports in
[#402](https://github.com/ProspectOre/matic-home-assistant/issues/402).

Back up Home Assistant, select `v0.5.3-rc3` in HACS with prereleases enabled,
and restart Home Assistant. Home Assistant 2026.10 or later is required.
