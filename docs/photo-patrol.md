# Photo patrol

[Actions](actions.md#photo-patrol) · [Privacy](privacy.md) · [Automation blueprints](automation.md)

`matic_robot.photo_patrol` visits up to 12 rooms, waits for the robot to report
the requested room, takes a photo there and returns the result. The camera faces
the direction the robot chooses when it stops; the action does not aim it at a
particular object.

## Set up privacy and safety

Open the integration's settings and choose **Photo patrol privacy and safety**.
Patrols are disabled until **Allow unattended photo patrols** is enabled. This
applies to every patrol call, including calls from an automation or assistant.
The manual **Take photo** button does not enable patrols.

Choose the rooms where Home Assistant must not take photos. The restriction
applies to patrols and manual snapshots. With blocked rooms configured, an
unknown room or an unavailable map stops a snapshot; a room removed by remapping
must be reviewed in settings before photo commands resume. These settings do not
control photos requested in the Matic app or erase photos already on the robot.

The minimum time between patrols defaults to 15 minutes. Only one patrol may run
per robot. It requires at least 20% battery, checks again between rooms, and stops
after 15 minutes. A nearby native schedule also prevents a patrol from starting.
If another clean or navigation takes over, the patrol yields to it.

## Results and notifications

Each result contains `room`, `photo_id`, `captured_at`, `url` and `preview_url`.
The default `url` serves a pixelated WebP mosaic. Home Assistant applies the
mosaic to the robot's preview when available, or to the full image otherwise. Set
`full_resolution: true` only when a full photo is wanted; `preview_url` always
refers to the preview. A missing preview does not fall back to a full photo.
Each photo also fires `matic_robot_photo_taken` with the same fields.

Both URLs require a signed-in Home Assistant user and disable browser caching.
Home Assistant retains the 16 newest photos in memory for these links. A restart
or newer photos can make a link unavailable. This limit does not delete images
from the robot; manage those in the Matic app.

```yaml
actions:
  - action: matic_robot.photo_patrol
    target:
      entity_id: vacuum.matic
    data:
      rooms: [Kitchen, Living room]
    response_variable: patrol
  - action: notify.mobile_app_my_phone
    data:
      message: Kitchen just now
      data:
        image: "{{ patrol.robots[0].photos[0].url }}"
```

The **Matic: Photograph room on alert** blueprint visits one room when a sensor
turns on. It uses the same opt-in, blocked-room and cooldown checks, and sends a
pixelated preview unless its full-resolution option is explicitly enabled.

## Stops and errors

The patrol requests docking when it finishes, or after an error, only while the
robot is still parked where the patrol left it.
It does not send a stop or dock command to interrupt a task that took over.
Docking is a request, not proof that the robot physically reached the dock.

No photo is returned for an unknown or mismatched room, an old capture, or an
unconfirmed arrival. Arrival has a three-minute limit and a new photo has a
40-second limit within the overall patrol deadline. These conditions produce an
error instead of attaching an incorrect room label.
