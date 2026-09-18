# 0.4.4.1 beta 1 — Map navigation stability

- Map Studio keeps the current zoom, pan, and orbit while live scene revisions
  arrive during navigation.
- Inactive camera preferences rebase their zoom when the scene bounds change,
  so switching views keeps the same visual scale after a map refresh.
- Initial loading and an explicit Fit map action still fit the complete scene.
- Saved fitted views remain fitted when switching between 2D, 3D, and drawing;
  user-adjusted views retain their map position and scale.
- Adds browser regression coverage for preserving a user-controlled camera when
  the live map scene is replaced.
- Managed plans now wait for firmware handoff between legs with different
  cleaning settings, and no longer send a redundant STOP while the robot is
  already returning to the dock.
- A Home Assistant restart during that handoff now resumes the next settings
  leg instead of abandoning the remaining queue.
- Graceful stop requests prevent the next settings leg, and a new external
  mission blocks a pending managed handoff without being replaced or stopped.

This beta is for testing the map-navigation and managed-plan handoff fixes.
Install it through HACS beta versions and restart Home Assistant before
testing. Live installation and physical acceptance remain separate from the
automated regression checks.
