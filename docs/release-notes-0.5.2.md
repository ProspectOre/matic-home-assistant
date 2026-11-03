# Matic 0.5.2

This update fixes the Home Assistant update-listener warning reported in
[#394](https://github.com/ProspectOre/matic-home-assistant/issues/394).
Changes to the robot's connection now schedule one integration reload, while
the **App-started cleanings** setting continues to take effect immediately.

Back up Home Assistant, update through HACS and restart. Home Assistant 2026.10
or later is required.
