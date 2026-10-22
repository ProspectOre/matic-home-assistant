# v0.5.0-rc37

RC37 carries every RC36 change and keeps every room's name on the 2D map.

A room label that would cover a neighbouring label was previously skipped,
so a small room beside another could show no name at all in 2D even though
3D showed it. A label now moves to the nearest free slot 24 or 48 px below
or above its room centre, and keeps the last slot when none is free, so no
room loses its name. A renderer regression places two neighbouring rooms
whose names collide and checks that both are drawn without overlapping; it
fails on the previous behaviour.

The Map Studio startup budget rises by 256 bytes to 92,416 gzip bytes. The
previous candidate had 4 bytes of headroom and this change needs 13.

Installed RC36 results are recorded in the
[continuity qualification](verification-0.5-area-continuity.md). The
supervised physical run and stable publication remain open.
