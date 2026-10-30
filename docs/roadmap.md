# Matic roadmap

Planned work after the current release. An entry is a commitment to decide, not to ship;
each names its tracking and what decides it. Work and betas for 0.6 happen on
`release/0.6`; `main` keeps the 0.5 stable line. Tracking:
[Matic 0.6 in Linear](https://linear.app/prospectore/project/matic-06-902a8a5637a4).

## 0.6

| Item | Tracking | Decided by |
| --- | --- | --- |
| Simulated robot and full-stack CI | [PRO-73](https://linear.app/prospectore/issue/PRO-73) | Lands first, so later items ship with end-to-end tests |
| Scripted installed check | [PRO-74](https://linear.app/prospectore/issue/PRO-74) | Runs on the owner's Home Assistant host |
| Upgrade from 0.5.0 and rollback drill | [PRO-75](https://linear.app/prospectore/issue/PRO-75) | Required because the map store changes |
| Sink refill ([#317](https://github.com/ProspectOre/matic-home-assistant/pull/317)) | [PRO-52](https://linear.app/prospectore/issue/PRO-52) | Review, CI and installed checks on `release/0.6` |
| Cleaning history with stop reasons | [PRO-60](https://linear.app/prospectore/issue/PRO-60) | |
| Go to room | [PRO-76](https://linear.app/prospectore/issue/PRO-76) | Follows sink refill, which adds the navigation command |
| Skip room and clean next for running plans | [PRO-77](https://linear.app/prospectore/issue/PRO-77) | |
| Occupancy-aware plans | [PRO-78](https://linear.app/prospectore/issue/PRO-78) | |
| Native schedules as a calendar | [PRO-79](https://linear.app/prospectore/issue/PRO-79) | Read only |
| [Binary tile store with streamed writes](design-binary-tile-store.md) | [PRO-71](https://linear.app/prospectore/issue/PRO-71) | Measured memory on the owner's host and the [#330](https://github.com/ProspectOre/matic-home-assistant/issues/330) reporter's 0.5.0 result; can ship earlier as a 0.5.x hotfix |
| No-go zones on Matic Map | [PRO-81](https://linear.app/prospectore/issue/PRO-81) | Read only; needs a recording to decode zones |
| Named robot alerts and Repairs | [PRO-82](https://linear.app/prospectore/issue/PRO-82) | Each code's meaning needs a recording or app text |
| Map trail | [PRO-83](https://linear.app/prospectore/issue/PRO-83) | |
| Robot marker that turns with heading | [PRO-84](https://linear.app/prospectore/issue/PRO-84) | Whether the robot reports heading |
| Wi-Fi signal heatmap | [PRO-85](https://linear.app/prospectore/issue/PRO-85) | |
| Zone, room and schedule editing | [PRO-86](https://linear.app/prospectore/issue/PRO-86) | Feasibility study first |
| Assist and MCP tools for the above | [PRO-80](https://linear.app/prospectore/issue/PRO-80) | Added as each feature lands |

## Later

Bluetooth proxy pairing ([PRO-44](https://linear.app/prospectore/issue/PRO-44)), a Matic Map
dashboard card and translations
([PRO-89](https://linear.app/prospectore/issue/PRO-89)).
