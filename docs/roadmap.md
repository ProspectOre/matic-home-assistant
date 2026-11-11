# Roadmap

[Releases](https://github.com/ProspectOre/matic-home-assistant/releases) ·
[0.6 beta 1 draft notes](release-notes-0.6.0-beta1.md) · [Compatibility](firmware-compatibility.md)

What is planned, with what each item waits on. Nothing here is a promise or a
date. 0.6 is built and tested on `release/0.6`; `main` holds the 0.5 stable
line. The `PRO-` numbers are the maintainer's tracker, which is not public: to
discuss an item, open a
[feature request](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=feature_request.yml).

## Before 0.6 is stable

The [draft notes](release-notes-0.6.0-beta1.md) list what 0.6 adds. These
checks are still open:

| Check | Why |
| --- | --- |
| [Upgrade drill](upgrade-drill.md) on the final commit, and a backup restored on a real host (PRO-75) | 0.6 changes the saved-map store, and 0.5 can't read the new one |
| [Installed check](installed-check.md) on the candidate (PRO-74) | Shows what a real host installed and loaded |
| Live updates over a real network: reconnects, lost messages and a robot that never serves the state subscription (PRO-130, PRO-131) | Tested on the simulated robot only |
| Matic Map on real phones and tablets, with a screen reader and at high zoom (PRO-144) | Browser tests emulate devices |
| A home with many rooms, several floors or several robots (PRO-138, PRO-139) | The [capacity lab](performance-map-lab.md) uses synthetic homes |
| Home Assistant 2026.11 (PRO-106) | Not tried yet |

## Planned

| Item | Waits on |
| --- | --- |
| Smaller, streamed storage for large photographic maps (PRO-71) | Memory measured on a real host |
| Named robot alerts as Repairs (PRO-82) | Each code needs a recording or the Matic app's own text |
| Editing the robot's rooms, zones and schedules (PRO-86, PRO-111) | A feasibility study; today these stay in the Matic app |
| Follow-me and point-to-go from Home Assistant (PRO-123) | New commands need the app's exact bytes and a try on a real robot |

Also planned: the robot's position streamed to Matic Map with smooth motion
(PRO-164), dock and cleaned-so-far map layers (PRO-170), a smoother Wi-Fi layer
(PRO-171), before and after photos for each room of a plan (PRO-119), pairing
through a Bluetooth proxy (PRO-44), a Matic Map dashboard card and translations
(PRO-89), and the protocol client as its own library (PRO-181).
