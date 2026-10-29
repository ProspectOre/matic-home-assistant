# v0.5.0-rc44

RC44 is the 0.5.0 stable candidate. It contains the full
[0.5.0 release notes](release-notes-0.5.0.md) plus three final corrections:

- Large single-floor homes keep up to four times as many photographic map
  pages within a bounded memory budget. A map cut short by an earlier version
  keeps its warning until the robot re-sends pages that were missing.
- A one-time clean can borrow a shared schedule for mop and vacuum-and-mop
  requests; mop-only work never resets a due vacuum rotation.
- Two-finger touch gestures choose pan, zoom, rotate, or 3D tilt once and keep
  that mode until you lift your fingers, so the map no longer pans and then
  snaps back when tilt starts.

This is a prerelease. Preserve a verified Home Assistant backup and the
installed integration and configuration stores before updating; follow the
[rollback guidance](verification-0.5-rc24.md). Installed and physical
qualification remain separate from source tests and review; see
[current qualification and its limits](verification-0.5-stable.md).
