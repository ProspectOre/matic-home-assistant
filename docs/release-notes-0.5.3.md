# Matic 0.5.3

This update fixes saved plans that never started, reported in
[#402](https://github.com/ProspectOre/matic-home-assistant/issues/402).
When the robot kept a past clean in its history that the integration could not
read, every plan stopped at once with "The robot's cleaning history could not be
read". That old clean no longer blocks new plans.

A clean the integration cannot read still never counts as a finished room. If
one appears during a plan, that plan's rooms stay unverified and due. If the
robot keeps a history entry that doesn't identify its clean, plans still won't
start, and the error now says so instead of suggesting a retry. Restart
recovery follows the same rules. See [cleaning results](native-cleaning-results.md).

Thanks to [parkerbxyz](https://github.com/parkerbxyz) for the report and the fix
in [#403](https://github.com/ProspectOre/matic-home-assistant/pull/403).

Back up Home Assistant, update through HACS and restart. Home Assistant 2026.10
or later is required.
