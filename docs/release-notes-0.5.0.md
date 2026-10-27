# v0.5.0

Matic 0.5 brings Map Studio, saved cleaning plans and run results together
in Home Assistant.

- Use one map workspace for live status, saved maps, room selection, custom
  areas, cleaning previews and results. Saved-map history stays read-only.
- Build plans in your saved order or with Smart Order, with room and area entries, per-room
  cleaning settings and private or shared cleaning schedules. Preview the
  effective settings before starting a run.
- See completed room counts, active cleaning time and an estimate of current-room
  progress based on time. Estimates do not grant completion credit.
  Smart Stop can finish the current room before docking, and **Stop now & dock**
  gives you an immediate choice while it is still cleaning.
- Keep the visible map and camera steady during updates, browsing and draft
  cancellation. Map options includes numeric zoom and presets for both Photo
  and Room colors; Fit also recenters the map.
- Use clearer drawing guidance, readable room labels, compact controls and
  recovery guidance across desktop, phone and tablet layouts.
- Review firmware changes through optional reports. Experimental pairing import
  is available on hosts without a local Bluetooth adapter; identity and
  authentication are checked before credentials are saved.

Periodic coverage can also be verified against the exact completed native
session when firmware clears its live coverage goals. Missing or contradictory
evidence keeps coverage due.

This release carries forward [RC43](release-notes-0.5.0-rc43.md) with stable
version metadata. It does not add a new runtime implementation after RC43.
The external pairing helper remains a separate project with its own platform
and hardware qualification.

Before updating, preserve a verified Home Assistant backup, the installed
integration and its plan/configuration stores. A source-only downgrade does
not necessarily restore newer stored run data. See the
[rollback guidance](verification-0.5-rc24.md).
