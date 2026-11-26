# Photo tours

[Actions](actions.md#photo-tours) · [Privacy](privacy.md) · [Automation blueprints](automation.md)

`matic_robot.run_photo_tour` visits its stops in order, photographs each
one and returns the photos, up to 12 photos in all. A stop is either:

- a room, `room: Kitchen`. The robot stops where it chooses in that room and
  faces whichever way it ends up.
- a saved viewpoint, `viewpoint: Front door`. The robot parks on the saved spot
  facing the saved direction. Add `look_around: 2` to `4` to turn in place and
  take that many photos, an equal share of a full turn apart.

Viewpoints are in beta: no real robot has driven to one yet. A simulator run
shows that the integration and the simulator agree, nothing more.

## Viewpoints

`matic_robot.save_photo_viewpoint` saves a named spot. Without coordinates it
saves where the robot stands and the way it faces, so drive it there in the
Matic app first. With `x`, `y` (metres on the map) and `heading` (degrees
counter-clockwise from the map's x axis) it saves that spot instead. A
viewpoint has to be inside a room, at least 25 cm from a no-go zone, and not in
a no-photo room. `matic_robot.delete_photo_viewpoint` removes one by name or ID.
Both are for administrators only. Viewpoints are kept in Home Assistant's
private storage and erased when the robot is removed.

The robot has reached a viewpoint once it parks within 40 cm of the spot,
facing within 20 degrees of the heading, in the viewpoint's room. A robot that
reports no heading, as on the dock, is taken to face the right way. It waits two
seconds before the photo so it is not blurred. A viewpoint saved on another
floor is refused until the robot is on that floor.

## Set up privacy and safety

Open the integration's settings and choose **Photo privacy and safety**.
Tours are disabled until **Allow unattended photo tours** is enabled.
This applies to every tour, including one from an automation or assistant.
The manual **Take photo** button does not enable tours.

Choose the rooms where Home Assistant must not take photos. The restriction
applies to tours, viewpoints and manual snapshots. With no-photo rooms
configured, an unknown room or an unavailable map stops a snapshot; a room
removed by remapping must be reviewed in settings before photo commands resume.
The check is on the room the robot stands in, not what the camera sees: a photo
from a permitted room can show a no-photo room through an open doorway, so aim
viewpoints away from one. A stop with `look_around` above 1 faces every
direction, so do not use it beside a doorway into a no-photo room. These settings do not control photos requested in the Matic app.

The minimum time between tours defaults to 15 minutes; `skip_cooldown: true`
starts one anyway, for a tour a person asked for. Only one tour may run per
robot. It requires at least 20% battery, checks again between stops,
and stops after 15 minutes. A robot schedule due soon also prevents a tour
from starting. If another clean or navigation takes over, the tour yields.

## Results and notifications

Each result names its stop: `room` for a room stop, or `viewpoint`, `room` and
`heading` (degrees) for a viewpoint. It also has `photo_id`, `captured_at`,
`url` and `preview_url`. The default `url` serves a pixelated WebP mosaic of
the robot's preview, or of the full image when there is no preview. Set
`full_resolution: true` only when a full photo is wanted; `preview_url` always
refers to the preview. `map_url` opens the photo in Matic Map's Photos, for
a notification to open on a tap. Each photo also fires `matic_robot_photo_taken` with the
same fields, with links that need a signed-in user.

With `report_failures: true`, a robot whose tour could not finish is returned
with no photos and `error`: its `reason` (for example
`photo_tour_low_battery`) and a plain-language `message`. The other robots
still run, and the action itself does not fail.

The action's links are signed: each opens that one photo, without signing in,
for 24 hours, so a phone or other notify target can fetch it. Browsers never
cache them.
Home Assistant saves every photo it reads from the robot to
`matic_robot/photos/<entry id>` in its configuration folder, so links survive a
restart. Each tour files its photos in an album of its own; other snaps go
to the Manual album. Photos older than 30 days are removed, and the oldest go
first once the folder passes 500 MB. Home Assistant does not delete images
from the robot; manage those in the Matic app. If a photo can't be written, a
Repair names the folder and the photo is saved on the next read.

```yaml
actions:
  - action: matic_robot.run_photo_tour
    target:
      entity_id: vacuum.matic
    data:
      stops:
        - viewpoint: Front door
        - room: Kitchen
    response_variable: tour
  - action: notify.mobile_app_my_phone
    data:
      message: Front door just now
      data:
        image: "{{ tour.robots[0].photos[0].url }}"
```

## Ask a question about a photo

Pass `question` and `ai_task_entity_id` together to have a Home Assistant AI
Task entity look at each photo. The entity must be able to generate data from
image attachments; the integration never picks an entity or provider for you.
It receives the full photo and your question, and its provider may send them
outside your home. Each photo then carries `analysis`, with `problem` (true or
false) and a short `summary`. The answer is returned to the caller only: it is
not added to the photo event, an entity or the log. The copy handed to the
entity is deleted when the answer arrives.

The **Matic: Photo check on alert** blueprint sends the robot to a viewpoint or
room when a sensor turns on or an alarm goes off. The phone hears "Matic is on
its way to look." at once, with a **Send home** button; the same notification
then shows the photo, captioned with your AI Task entity's answer or the place
and time. A look-around adds its other photos to the same stack. If the robot
is busy, no photo could be taken or Send home stopped the check, the
notification says why in a few words, such as "Matic couldn't reach Front
door. Is a door closed?" Previews are pixelated unless **Send the full photo** is
on, and **Time-sensitive notifications** marks them time sensitive on iPhone
and high priority on Android.

Administrators can also ask Assist or an MCP client: `MaticTakePhoto` returns
a pixelated preview of one room or viewpoint, and `MaticInvestigate` adds a
question for an AI Task entity you name. Both run a one-stop tour with
every check above.

## Stops and errors

The tour requests docking when it finishes, or after an error, only while
the robot is still parked where the tour left it. Start, Pause, Stop or Return
to dock on the robot's Home Assistant entity ends a running tour with an error
before it sends the robot anywhere else; photos it already took are kept. It does not send a stop
or dock command to interrupt a task that took over. Reloading or disabling
the integration ends a running tour the same way, and sends the robot
nothing: a robot parked at a stop docks on its own after its ten-minute
countdown, as it does after any Go to room. Docking is a request, not
proof that the robot physically reached the dock.

No photo is returned for an unknown or mismatched room, an old capture, or an
unconfirmed arrival. Arrival has a three-minute limit and a new photo has a
40-second limit within the overall tour deadline. These conditions produce
an error instead of attaching an incorrect label.
