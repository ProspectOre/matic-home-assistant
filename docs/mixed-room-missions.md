# Mixed room missions

Managed plans preserve each room's cleaning mode and coverage setting inside
one ordered native mission. A settings change no longer requires the integration
to finish one mission at the dock before starting the next.

The robot still controls resource servicing: water, battery, or other preparation
may interrupt cleaning. This is not a promise that it will never visit the dock.

## Safety and recovery

- Per-room updates require the generated native session, the original room map,
  the first room actively cleaning, and a current managed command generation.
- Neither the start nor the update is replayed after ambiguous transport failure.
- Failure cleanup may stop only the same owned native session, never a replacement.
- Older saved run checkpoints retain their original mission boundaries.
- Completion is verified separately for each room's requested mode using native
  history. A command acknowledgement is not completion evidence.
