# Native cleaning results

The local cleaning-sessions sensor and administrator-only MCP history retain
separate vacuum and mop results for each room. Each mode reports `completed`,
`partial`, `unattempted`, or an unknown status, plus its recorded duration.
An absent mode has no result. Unattempted does not establish a cause: the
integration does not infer an obstruction or the absence of moppable floor.
The additional sensor attribute `latest_mode_results` is excluded from recorder.
The shared visited-room list excludes unattempted and unknown results in the
sensor, finished event, and MCP response. Partial or completed native work
updates rotation opportunity; an external run does not earn managed completion
credit merely from this activity import.

A managed vacuum-only dispatch requires explicit vacuum completion; mop-only
requires mop completion; vacuum-and-mop requires both. A completed vacuum mode
cannot satisfy a combined dispatch with partial or absent mop evidence. Each
requested mode also needs a positive duration. Combined duration adds the two
mode durations; it never replaces vacuum time with mop time.

The native record must still be new, overlap the managed dispatch, and match
unambiguous room names. A partially completed multi-room mission credits only
its verified subset and cannot automatically advance to the next settings leg.
Missing, duplicate, malformed, and unknown results remain uncredited. Existing
managed records are not retroactively rewritten by this decoder correction.

## Protocol evidence

The official app's `AreaModeSummary` encoder and conversion model establish
that SessionSummary groups 6 and 7 contain vacuum and mop maps. Map-value field
5 is a per-mode status: protobuf default 0 is unattempted, 1 is partial, and 2
is completed. Field 6 is a cleaning setting, not a second mode status. This
mapping also matches a physical mixed-outcome session and the app's displayed
per-mode results. No cleaning commands change.

Synthetic coverage includes separate and combined modes, partial multi-room
missions, an absent mode, omitted zero status/duration, settings independent of
status, ambiguous/unknown values, missing duration, and restart reconciliation.
See `tests/test_native_completion_modes.py`.
