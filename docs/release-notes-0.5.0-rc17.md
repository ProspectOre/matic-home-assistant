# 0.5.0 RC17 — Map recovery and responsive fallback

- Keep cleaning and map editing unavailable while the robot's floor is unknown,
  including when an earlier map read finishes during recovery.
- Recheck that the robot is still idle before starting a mixed-mode clean.
- Reject managed plans whose room names are indistinguishable in native
  completion history, before sending any cleaning command.
- Keep the 2D fallback aligned with room selection after graphics context loss,
  with drawing spread across short tasks so navigation can remain responsive.
- Bound Auto map detail on touch devices, preserve the workspace after unknown
  UI events, and improve RTL keyboard navigation and localized landmarks.

This is a release candidate. Install through HACS beta versions and restart
Home Assistant. Candidate installation, physical cleaning, cadence progression
and device/accessibility acceptance are tracked in the
[qualification record](verification-0.5-rc17.md).
