# v0.5.0

Matic 0.5 brings Map Studio, saved cleaning plans and cleaning history together
in Home Assistant.

- Use one map workspace for live status, saved maps, room selection, custom
  areas, cleaning previews and results. Saved-map history stays read-only.
- Build ordered or intelligent plans with room and area entries, per-room
  cleaning settings and private or shared cleaning schedules. Preview the
  effective settings before starting a run.
- Follow verified room progress, active time and clearly labeled estimated
  progress. Estimates do not grant completion credit. Stop respects the saved
  finish-current-room policy and keeps interrupted results visible.
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

This release carries forward [RC40](release-notes-0.5.0-rc40.md) with stable
version metadata. It does not add a new runtime implementation after RC40.
The external pairing helper remains a separate project with its own platform
and hardware qualification.

Before updating, preserve a verified Home Assistant backup, the installed
integration and its plan/configuration stores. A source-only downgrade does
not necessarily restore newer stored run data. See the
[rollback guidance](verification-0.5-rc24.md).
