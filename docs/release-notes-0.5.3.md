# Matic 0.5.3

This update fixes saved plans that never started, reported in
[#402](https://github.com/ProspectOre/matic-home-assistant/issues/402).
When the robot kept a past clean in its history that the integration could not
read, every plan stopped at once with "The robot's cleaning history could not be
read". That old clean no longer blocks new plans.

In RC2, a saved plan keeps running if its caller disconnects after Home Assistant
accepts it. Disconnecting before acceptance cancels the request.

Home Assistant now waits for the history entry with the run's own identifier.
A gap in the robot's history stream or an unrelated unreadable entry no longer
decides which clean finished. If the run's own record is missing or unreadable,
its rooms stay unverified and due. If the
robot keeps a history entry that doesn't identify its clean, plans still won't
start, and the error now says so instead of suggesting a retry. Restart
recovery follows the same rules. See [cleaning results](native-cleaning-results.md).

Thanks to [parkerbxyz](https://github.com/parkerbxyz) for the report and the fix
in [#403](https://github.com/ProspectOre/matic-home-assistant/pull/403).

Back up Home Assistant, update through HACS and restart. Home Assistant 2026.10
or later is required.
