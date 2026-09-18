# 0.4.4.1 beta 1 — Map navigation stability

- Map Studio keeps the current zoom, pan, and orbit while live scene revisions
  arrive during navigation.
- Inactive camera preferences rebase their zoom when the scene bounds change,
  so switching views keeps the same visual scale after a map refresh.
- Initial loading and an explicit Fit map action still fit the complete scene.
- Adds browser regression coverage for preserving a user-controlled camera when
  the live map scene is replaced.
- Managed plans now wait for firmware handoff between legs with different
  cleaning settings, and no longer send a redundant STOP while the robot is
  already returning to the dock.

This beta is for testing the map-navigation and managed-plan handoff fixes.
Install it through HACS beta versions and restart Home Assistant before
testing. Browser tests requiring
local Playwright binaries were not runnable in the release environment; the
TypeScript build, Python release checks, privacy check, and lint pass.
