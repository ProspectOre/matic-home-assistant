# Automations

[Documentation](README.md) · [Actions](actions.md) · [Entities](entities.md)

Run a saved plan when everyone leaves, clean a custom area after a pet-device
cycle, or react when a room finishes. Replace example entity IDs with those
shown on your robot's device page.

## Ready-to-import blueprints

| Blueprint | Import |
| --- | --- |
| Matic: Clean when everyone leaves | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fclean_when_away.yaml) |
| Matic: Clean during quiet hours | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fquiet_hours.yaml) |
| Matic: Clean after pets leave | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fpet_aware.yaml) |
| Matic: Clean on a schedule | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Froom_rotation.yaml) |
| Matic: Send firmware alerts | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Ffirmware_intelligence.yaml) |
| Matic: Photograph room on alert | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fphoto_on_alert.yaml) |

- Every cleaning blueprint starts only when the robot is docked or idle, and
  uses Run Smart Order, so the longest-waiting rooms and custom areas go first
  whatever the plan's saved order. Leave Plan empty to run the default plan.
- A household member is away unless their state is `home`, `unknown` or
  `unavailable`, so someone in a named zone such as Work counts as away. When
  anyone comes home, Clean when everyone leaves calls Stop cleaning.
- Clean after pets leave runs at most once a day. Clean during quiet hours
  checks the battery only when you choose a sensor.
- Send firmware alerts finds the robot from the Firmware check status sensor.
- Photograph room on alert runs a [photo patrol](actions.md#photo-patrol) of one
  room when any chosen sensor turns on and the robot is docked or idle, then
  sends the photo to your phone, or a message if the robot couldn't take it.
  Enable patrols and set no-photo rooms in the integration's settings first.
  Notifications use pixelated previews unless full resolution is selected.
  Alerts during the cooldown are ignored.

## Clean action

Start cleaning (`matic_robot.clean`) takes room names or IDs, a cleaning mode,
vacuum coverage and ordering; omit `rooms` for the whole floor ([all fields](actions.md#cleaning)).

```yaml
actions:
  - action: matic_robot.clean
    target:
      entity_id: vacuum.matic
    data:
      rooms: [Kitchen, Study]
      cleaning_mode: vacuum_and_mop
      ordered: true
```

## Saved plans

Create a plan in [Matic Map](cleaning.md#saved-plans), then call Run plan
(`matic_robot.run_selected_plan`) with a `plan` name or ID, or none for the
default plan. Preview next plan run (`matic_robot.preview_plan`) returns the
next order and settings without starting. Run Smart Order (`intelligent_clean`)
starts with what has waited longest; Run saved order (`clean_entire_plan`)
keeps the saved order. Stop cleaning (`stop_intelligent_cleaning`) applies the
plan's [stop setting](cleaning.md#stopping-a-plan). To run, pause or change a
plan in Matic Map, see [plan Run and Edit](cleaning.md#run-and-edit).

See [how a plan runs](cleaning.md#how-a-plan-runs) for room and area ordering.

<a id="painted-custom-areas"></a><a id="drawn-custom-areas"></a>

## Custom areas

[Save a custom area](cleaning.md#custom-areas), then call it by name:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.litter_box_cycle
    from: "on"
    to: "off"
actions:
  - action: matic_robot.clean_area
    target:
      entity_id: vacuum.matic
    data:
      area: Litter box
```

This sends no area events, and Cleaning finished doesn't name the area. To
react to a custom area by name, put it in a plan and use Plan area finished.

## Matic Cues

The `matic_robot_cues` event carries `device_id`, `entry_id` and `event_type`;
`intent_classified` also includes `intent`.

Event types: `disabled`, `ready`, `wake_word_detected`, `intent_processing`,
`intent_classified`, `intent_rejected`, `gesture_awaiting_pointed_target`,
`gesture_pointed_target_accepted`, `gesture_no_target_found`,
`gesture_facing_user`, `gesture_person_not_found`, `gesture_following`,
`following_started` and `following_stopped`.

Recognized commands: `clean`, `clean_all`, `dock`, `go_away`, `navigate`, `pause`,
`redo_last_clean`, `resume`, `sink_summon`, `stop`, `follow_person`,
`point_to_clean` and `unknown`. See [Cues data handling](privacy.md#matic-cues)
before automating the switch.

## Events and observability

See [automation events](automation-events.md) for event types, fields and device triggers.

<a id="entity-contract"></a><a id="map-studio"></a><a id="plan-actions"></a><a id="payload-free-endpoint-inspection"></a><a id="firmware-snapshots"></a><a id="diagnosing-a-robot-error"></a><a id="room-statistics-and-the-recorder"></a><a id="fault-semantics"></a>

## More reference

[Entities, errors, and statistics](entities.md) · [Map controls](cleaning.md#matic-map) ·
[All action fields](actions.md) · [Firmware checks](firmware-compatibility.md)
