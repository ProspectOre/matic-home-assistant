# 0.2.1

- Fixes plan dropdowns closing, being clipped, or turning off selected rooms.
- Refreshes frontend assets reliably after an update.
- Adds **Finish the current room when stopping**, with a 0–100% threshold based on learned cleaning time. Below it, stop immediately; at or above it, finish the active room and dock. With no learned duration, finish the room; 0% always finishes it.

The new stop policy is off by default. Enable it in the plan editor.
