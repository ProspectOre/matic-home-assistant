# Release notes — 0.2.1

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

0.2.1 fixes the saved-plan editor and adds an opt-in way to finish a nearly
complete room when a plan is stopped, without continuing through the plan.

## Fixed

- **Room settings no longer turn rooms off.** Cleaning-mode and coverage
  dropdown events stay inside the room editor, so changing a setting can no
  longer replace the complete room list with one scalar value.
- **Dropdowns stay open and clickable.** Routine Home Assistant state updates
  no longer rebuild the editor DOM, and room-list styling no longer clips
  menus near the bottom of the plan.
- **Frontend updates bypass stale browser caches.** The editor URL now includes
  a digest of its JavaScript content as well as the integration version.

## Finish the current room when stopping

Each saved plan now has **Finish the current room when stopping** and a
configurable **Finish-room progress threshold** from 0–100%.

- Below the threshold, the robot stops immediately and the room remains due.
- At or above the threshold, the active room completes, no next room starts,
  and the robot docks.
- Until the integration has learned a matching successful room duration,
  enabling the policy finishes the current room. Set the threshold to `0%` to
  always finish it.
- Immediate stopping remains the default for existing and newly created plans.

The robot does not expose a trustworthy live mapped-area percentage. The
integration therefore estimates progress from elapsed time against successful
managed runs of the same room with the same cleaning mode and coverage. A
settings change clears the learned duration for that room.

## Upgrade

Update through HACS, restart Home Assistant, then open **Settings → Devices &
services → Matic (Unofficial) → Configure** to edit the new plan options. No
configuration migration or re-pairing is required.

## Verification

The release passes 442 tests at 100% coverage, Ruff, strict MyPy, the
privacy/public-tree check, Hassfest, and HACS validation.
