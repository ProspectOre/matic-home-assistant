# v0.5.0-rc36

RC36 carries every RC35 change and fixes one 2D map readability defect found
during installed RC35 qualification.

In Room colors, a room drawn later could paint over an earlier room's name,
so overlapping or adjacent rooms (for example, a small room beside a hallway)
showed clipped or missing labels. Room names now draw after every room fill,
so each name sits above all room colors. Label collision handling, plates and
badges are unchanged, and the robot marker still draws above labels. A
renderer regression checks the draw order and fails on the previous order.

Installed RC35 results are recorded in the
[continuity qualification](verification-0.5-area-continuity.md). The
supervised physical run and stable publication remain open.
