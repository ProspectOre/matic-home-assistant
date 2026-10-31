# Entities and controls

[Documentation](README.md) · [Automations](automation.md)

Build dashboards, adjust settings, and use cleaning results in automations.
Enable per-room statistics to track each room’s last clean and successful duration.

Each robot has fixed entities and two opt-in statistics sensors per mapped room.

## Names and entity IDs

See the [entity reference](entity-reference.md) for names, IDs, defaults and sensor behavior.

## Controls

Use Matic Map for plans, room selection, and custom areas, or the standard vacuum
controls for a full-floor clean, pause/resume, Stop, and dock; the vacuum's Stop
follows a running plan's Smart Stop setting. Default mode and coverage appear
under **Configuration**. The five specialized buttons and the plan/area selectors
are opt-in dashboard and automation shortcuts; existing enabled choices and
entity IDs are preserved.

The plan buttons have the same names as their actions: **Run plan** runs the
default plan the way it is saved, **Run Smart Order** cleans the rooms and
custom areas that have waited longest first, and **Run saved order** cleans
them top to bottom; a plan runs in one or more [parts](cleaning.md#how-a-plan-runs).
They are unavailable until the map is ready and the default plan can run. **Stop
cleaning** is available only while a plan or a one-time room clean from Matic
Map runs, and never asks for confirmation; the plan's Smart Stop setting decides
whether the current room finishes first. **Clean custom area** cleans the area
chosen in **Custom cleaning area**, so enable both. **Next room to clean** names
the first room or custom area of the default plan's next run; its `preview`
attribute holds the whole preview.

## Maps

`camera.matic_map` provides a labeled room map for dashboards. The photographic
SLAM camera is disabled by default; enable it from the device's entity list if
needed. Both return PNG images. Administrators also get the **Matic Map** panel.

## Photos

The robot has a camera. **Take photo** asks it to take a picture, the same as
the snap emote: it counts down for about nine seconds, then saves the photo on
the robot. `image.matic_latest_photo` shows the newest photo on the robot,
including ones taken from the Matic app, as a WebP image. Its state is the
capture time, so an automation can trigger on a state change of the image
entity to act on each new photo, for example to send it in a phone
notification with `image: /api/image_proxy/image.matic_latest_photo`, or save
it with `image.snapshot`. The `photo_count` attribute counts the photos seen on
the robot. Home Assistant keeps the 16 newest in memory for
[photo patrol](actions.md#photo-patrol) links. A photo deleted
in the Matic app stays here until the integration reloads.

## Maintenance

The robot's monthly cleaning recap can suggest maintenance. **Maintenance
suggested** is on while the newest recap does, and a Repair names the recap
month. The Repair clears when a newer recap stops suggesting maintenance, and
dismissing it hides only that month's notice. The sensor stays unknown until a
recap can be read. The recap lists parts by code, and which code means which
part (brush roll, side brush, mop roll, caster and wedge) is not known yet, so
check them all.

**Bag pass ends** shows when an active bag pass runs out, and is unknown without
one.

## Firmware

The firmware update entity is read-only; the robot installs updates itself and
doesn't publish the new version number in advance. While it reports an update,
the latest version reads "Newer than" the installed version (or "Newer
firmware" if that is unknown), in Home Assistant's language. **Skip** lasts
until that text changes: after the robot installs firmware or when Home
Assistant's language changes. A second update offered before the robot installs
the first stays skipped. With no installed version, Home Assistant shows the
update's state as unknown, so there is nothing to skip. The device page shows
the software and hardware versions.

If **Problem** turns on, `sensor.matic_activity` names the reported conditions
in `errors` and `primary_error` and keeps their numeric codes in
`hermes_error_codes`; a code with no known meaning appears as `error_code_<n>`.
An error must persist across two normal polls before it appears, which filters
brief firmware pulses. Recorded activity can help diagnose an error after it clears.

**Robot alert** names the alert when its code has a known meaning (bag full,
bag missing) and shows Unknown alert otherwise. Its `unknown_codes_seen`
attribute keeps when each unmapped code first and most recently started, so a
code can be named later by matching it to what the Matic app showed at that time.
A full or missing bag also raises a Repair with the fix, which clears when the
robot stops reporting it.

## Room statistics and the recorder

Each room's **Last cleaned** and **Last clean duration** sensors are disabled
by default. Enable them to retain room-specific history and duration statistics.
The robot-wide **Last clean duration** is recorded by default. Room sensors
show the latest confirmed result, whatever its cleaning mode and coverage.

Room lists, SSID, schedules, detailed run results, and plan history remain
available to templates through `state_attr()` but are excluded from Recorder
attributes. See [privacy](privacy.md) for stored data and event data.

## Robot schedules

**Robot schedules** is a read-only calendar of the weekly schedules set in the
Matic app, in each schedule's time zone (else the robot's). The robot stores no
end time, so each run is a one-hour block. Descriptions give the cleaning mode,
the rooms and whether order is kept. Switched-off schedules are hidden; details stay out of
Recorder. Matic Map shows the next run at the top of Cleaning history.

## Matic Cues

Voice and gesture sensors, a following-person binary sensor, and the Cues event
entity expose robot-reported lifecycle changes. The integration receives no
transcripts, media, or pointing coordinates. Enabling the Cues voice assistant
switch also activates [Matic's voice processing](privacy.md#matic-cues).

## Entity ID history

The one-time 0.2 migration renamed older numbered IDs where possible. 0.5
removed four duplicate entities once, on its first start; see the
[release notes](release-notes-0.5.0.md#before-you-update) for replacements.
User-assigned names and IDs are preserved.

## Assistant tools

See [Assistant and MCP tools](assistant-tools.md) for administrator access,
status and cleaning actions, and the separate firmware research tools.
