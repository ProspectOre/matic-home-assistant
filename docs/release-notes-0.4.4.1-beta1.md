# 0.4.4.1 beta 1 — Map navigation stability

- Map Studio keeps the current zoom, pan, and orbit while live scene revisions
  arrive during navigation.
- Initial loading and an explicit Fit map action still fit the complete scene.
- Adds browser regression coverage for preserving a user-controlled camera when
  the live map scene is replaced.

This beta is for testing the map-navigation fix. Install it through HACS beta
versions and restart Home Assistant before testing. Browser tests requiring
local Playwright binaries were not runnable in the release environment; the
TypeScript build, Python release checks, privacy check, and lint pass.
