# Matic 0.5.3

This update fixes saved plans that never started, reported in
[#402](https://github.com/ProspectOre/matic-home-assistant/issues/402).
When the robot kept a past clean in its history that the integration could not
read, every plan stopped at once with "The robot's cleaning history could not be
read". That old clean no longer blocks new plans. A clean the integration cannot
read still never counts as a finished room.

Thanks to [parkerbxyz](https://github.com/parkerbxyz) for the report and trace.

Back up Home Assistant, update through HACS and restart. Home Assistant 2026.10
or later is required.
