# Matic 0.5.3 RC3

Saved plans can start with old, unreadable entries in robot history. Home
Assistant waits for the result from the session it started, including when the
robot delivers history in batches or retains a large custom-area result. Rooms
stay due when their own completion cannot be verified.

An accepted saved plan keeps running if the caller disconnects. You can still
stop it from Home Assistant.

Between missions, Home Assistant compares history keys without decoding older
cleaning results. When the robot supplies a session marker, Home Assistant
checks it before starting the next mission. A changed marker, such as after a
robot reboot, leaves the remaining rooms due. Restart recovery checks the saved
marker before resuming a handoff.

If you switch back from the 0.6 beta, the integration preserves the newer map
history cache and can start with a temporary cache.

Thanks to [parkerbxyz](https://github.com/parkerbxyz) for the fix in
[#403](https://github.com/ProspectOre/matic-home-assistant/pull/403) and the beta
testing and follow-up reports in
[#402](https://github.com/ProspectOre/matic-home-assistant/issues/402).

Back up Home Assistant, select `v0.5.3-rc3` in HACS with prereleases enabled,
and restart Home Assistant. Home Assistant 2026.10 or later is required.
