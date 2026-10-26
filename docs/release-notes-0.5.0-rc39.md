# v0.5.0-rc39

RC39 prepares the map continuity and precision repairs for installed testing.
It includes the changes described in [RC38](release-notes-0.5.0-rc38.md).

- Keep the complete visible map while a replacement scene uploads within the
  same verified map context. Sustained updates finish staged uploads before
  taking the latest replacement, while camera input and Fit remain effective.
- Keep room labels steady during map movement and repack crowded labels when
  retained positions would hide another label that can fit.
- Add Map options → Map zoom with a 100–1000% field and 100%, 400% and 1000%
  presets. Zoom uses the same camera as gestures, supports Photo and Room colors,
  and preserves separate live and saved-map preferences. Setting 100% preserves
  the current center; Fit also recenters the map. Invalid entries do not move it.
- Derive the Draw scale bar from the actual camera projection and viewport.
  Keep large brush cursors visible when their edge extends beyond the viewport.
- Preserve keyboard focus, correct popup semantics and usable compact controls.
- Keep the open zoom readout accurate through resizing and reconnecting, while
  preserving a percentage being typed until it is applied.
- Keep an expected area-in-use refusal out of persistence-failure logs, while
  continuing to report real storage errors and preserve the saved plan.

The compressed startup cap is 92,544 bytes, including the approved 128-byte
increase for the map-label repair. The final built candidate must meet that cap.

These source repairs do not establish the cause or resolution of intermittent
whole-page reloads, blank shortcuts or missing robot coordinates reported on
RC38. Pose freshness and map identity checks remain enforced. Installed iPhone
retesting is required; prior browser or RC38 results do not qualify this build.

Before updating, preserve a verified Home Assistant backup, the installed
integration and its plan/configuration stores. Follow the
[rollback guidance](verification-0.5-rc24.md); a source-only downgrade does not
necessarily restore newer stored run data. This remains a prerelease, with
whole-product device, physical and owner acceptance still required by the
[0.5 acceptance criteria](acceptance-0.5.md).
