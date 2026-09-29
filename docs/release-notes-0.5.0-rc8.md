# 0.5.0 RC8 — Workspace shutdown cleanup

This release candidate fixes a duplicate listener-removal error during Home
Assistant shutdown. The workspace now owns the stop listener through the same
idempotent cleanup path as its other listeners.

Install through HACS beta versions and restart Home Assistant. Saved plans,
room schedules, and robot settings are unchanged. Exact-candidate restart and
physical acceptance remain separate release gates.
