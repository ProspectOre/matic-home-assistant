# Matic 0.5.6

A map edit in the Matic app can remove a room or re-create it with a new ID.
A saved plan that still names the old room now says so: running it fails with
an error that lists the rooms no longer on the map, instead of "The plan request
cannot run", and Home Assistant raises a Repair that names each plan to update.
The Repair clears once every plan names only rooms on the map.

**Remove room or area from plan** (`delete_plan_room`) now removes a room the
plan holds even when the room is no longer on the map, so a stale room can be
taken out of a plan without saving the whole plan again.

**Save plan** and **Save room to plan** now show each room's schedule settings
(mop every N cleans, vacuum rotation, and which plans share the count) in the
action editor. The actions already accepted them; they were missing from the
form.

Thanks to @parkerbxyz for reporting #517 and #518.

Back up Home Assistant, update Matic to `v0.5.6` in HACS, and restart Home
Assistant. Home Assistant 2026.10 or later is required.
