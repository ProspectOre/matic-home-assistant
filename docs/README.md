# Matic guides

[Project overview](../README.md) · [What Home Assistant adds](features.md) ·
[Releases](https://github.com/ProspectOre/matic-home-assistant/releases)

## Get more from your robot

| I want to… | Start here |
| --- | --- |
| Rotate fairly through rooms and save per-room settings | [Plans and Smart Order](cleaning.md#saved-plans) |
| Mix rooms and custom areas, and know when the robot docks | [How a plan runs](cleaning.md#how-a-plan-runs) |
| Mop or deep-clean a room every few cleans | [Room schedules](room-schedules.md) |
| Clean when I leave or another device triggers it | [Automations and blueprints](automation.md) |
| Finish the current room before docking | [Smart Stop](cleaning.md#stopping-a-plan) |
| Skip a room, clean one next or clean one again mid-clean | [Changing a running clean](queue-changes.md) |
| Draw reusable areas | [Custom areas](cleaning.md#custom-areas) |
| Move around the map, browse saved maps and turn on map layers | [Matic Map](map.md) |
| Build a dashboard or use room statistics | [Entities](entities.md) |
| Understand what actually finished | [Cleaning results](native-cleaning-results.md) |
| Photograph a room while respecting privacy settings | [Photo patrol](photo-patrol.md) |
| Ask Assist about the robot or have it start a clean | [Assistant tools](assistant-tools.md) |

## Setup and help

- [Install or update](../README.md#install) and [pair the robot](hermes-pairing.md).
- [What you need](../README.md#what-you-need), and
  [compatibility](firmware-compatibility.md): the robot firmware checked so far
  and known limits.
- [Troubleshooting](troubleshooting.md): start here when something goes wrong.
  It leads to [interrupted cleaning](activity-diagnostics.md), a
  [Home Assistant restart during a clean](restart-recovery.md),
  [firmware alerts](firmware-intelligence.md) and
  [robot schedules that look wrong](native-schedule-diagnostics.md).
- [Privacy](privacy.md): what is stored, who can see it and how to remove it.

[Report a bug](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=bug_report.yml) ·
[Request a feature](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=feature_request.yml) ·
[Community discussion](https://community.home-assistant.io/t/matic-unofficial-local-robot-vacuum-control-map-room-plans-and-intelligent-rotation/1017684)

## Reference for automations

- [Actions](actions.md), with [plan actions](plan-actions.md) and
  [robot command actions](robot-command-actions.md).
- [Entities](entities.md) and the [entity reference](entity-reference.md).
- [Automation events](automation-events.md).

## For contributors

Start with [Contributing](../CONTRIBUTING.md) and [Security](../SECURITY.md).

| Topic | Read |
| --- | --- |
| How the code is organized | [Architecture](architecture.md) |
| Sharing the robot with the Matic app | [Working alongside the Matic app](coexistence.md) |
| Words shown to users | [Copy style](copy-style.md) |
| The robot's local protocol | [Robot protocol map](firmware-endpoint-map.md), [protocol notes](protocol-notes.md) and the [pairing import contract](pairing-import-contract.md) |
| Tests and what each one proves | [Testing](testing.md), the [plan run contract](e2e-contract.md), the [simulated robot](e2e-harness.md), the [installed check](installed-check.md), the [upgrade drill](upgrade-drill.md) and the [map capacity lab](performance-map-lab.md) |
| Reviews and releases | [Review and manual merge](maintenance-reviews.md), the [roadmap](roadmap.md) and the [0.6 beta 1 draft notes](release-notes-0.6.0-beta1.md) |

## Older records

Release notes are on the
[releases page](https://github.com/ProspectOre/matic-home-assistant/releases);
the 0.5 upgrade steps are also [kept here](release-notes-0.5.0.md). The longer
notes for each release up to 0.5.1, with the 0.5 test records, performance
reports, interface specification and release candidate notes, were removed
from this folder and remain in the
[v0.5.3 tree](https://github.com/ProspectOre/matic-home-assistant/tree/v0.5.3/docs).
Source comments that cite files such as `ux-spec-0.5/plan.md` or
`copy-style-0.5.md` refer to that tree. The 0.6 map design proposals are in
[an earlier commit](https://github.com/ProspectOre/matic-home-assistant/tree/c71361576978b4bf71dc818673cc9348987b4db5/docs).
