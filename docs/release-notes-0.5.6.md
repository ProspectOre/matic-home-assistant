# Matic 0.5.6

A map edit in the Matic app can remove a room or re-create it with a new ID.
A saved plan that still names the old room now says so: running it fails with
an error that lists the rooms no longer on the map, instead of "The plan request
cannot run", and Home Assistant raises a Repair that names each plan to update.
The Repair clears once every plan names only rooms on the map.

**Remove room or area from plan** (`delete_plan_room`) now removes a room the
plan holds even when the room is no longer on the map, so a stale room can be
taken out of a plan without saving the whole plan again.

A plan no longer ends when the robot cleans only part of a room and returns to
the dock on its own, for example because an obstacle blocks the rest of the
floor. The room is recorded as partly cleaned, gets no completion credit so it
stays due, and the plan moves on to the next room when **Finish current room**
is on. The work the robot did still
counts toward the room's mop schedule like any clean, and a mop it started
counts as the room's due mop. The Matic app shows that clean as **Area
inaccessible**, the same as a room the robot could not reach at all, which
counts for nothing.

If Home Assistant still shows the vacuum as paused after cleaning ends, the plan keeps credit for rooms the robot finished. Its cleaning history
must confirm every mode the plan requested for each room. If another task
takes over, the plan stops.

**Save plan** and **Save room to plan** now show each room's schedule settings
(mop every N cleans, vacuum rotation, and which plans share the count) in the
action editor. The actions already accepted them; they were missing from the
form.

Thanks to @parkerbxyz for reporting #517, #518 and #566.

Back up Home Assistant, update Matic to `v0.5.6` in HACS, and restart Home
Assistant. Home Assistant 2026.10 or later is required.
