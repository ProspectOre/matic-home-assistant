# Matic roadmap

Planned work after the current release. An entry is a commitment to decide, not to ship;
each names the evidence that decides it and the release it could land in.

## Map experience redesign

[PRO-138](https://linear.app/prospectore/issue/PRO-138) tracks the proposed
[task-first map experience](design-map-experience.md): 2D selection and editing,
tightly framed photographic live overview, shared spatial identity and explicit qualification gates.
[Saved-map storage](design-map-storage.md) includes keeping, retention, export and deletion.
Design and prototype work precede implementation; no release is assigned. Existing
0.6 requirements, beta-2 live status and after-0.6 workspace push keep their scope.

## After 0.5.0 stable

| Item | Tracking | Target | Decided by |
| --- | --- | --- | --- |
| [Binary tile store with streamed writes](design-binary-tile-store.md) | [PRO-71](https://linear.app/prospectore/issue/PRO-71) | 0.5.x hotfix, or the 0.6 map updates | Stable users testing the 0.5.0 large-floor capacity fix, plus a measured memory ceiling on the owner's Home Assistant host |

### Binary tile store

0.5.0 stable ships the large-floor capacity fix (#331): resident raw map pages are capped at
128 MiB. Every save and load still passes the active floor through base64 and Home
Assistant's JSON store, which is the root cause of the remaining memory peaks and of
whole-file rewrites. The design replaces that path with an append-only binary page file and
a small JSON index.

Sequence the owner chose on 2026-10-29: release 0.5.0 stable with #331, have affected users
test it, then either ship the binary store as a 0.5.x hotfix (if stable users or the host
measurement show memory pressure) or fold it into the 0.6 map updates.
