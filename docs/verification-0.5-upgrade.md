# 0.5 upgrade check: 0.4.8 to 0.5.0-rc37

Checked on 2026-10-22 on a throwaway Home Assistant 2026.10.2 (Python 3.14)
with no robot attached. The robot address was unreachable on purpose, so the
entry stays in setup retry and the robot-dependent setup isn't exercised. The
seeded data is synthetic.

## Method

1. Started a fresh Home Assistant, then seeded a 0.4.8-format config entry
   (version 1.2), six registry entities (including the four that 0.5 retires),
   and plan storage at version 1.5. The plan storage held two plans (one
   disabled), a custom area, selections, global room history, and per-plan
   rotation records (one completed, one failed).
2. Ran 0.4.8 to confirm the baseline loads.
3. Replaced the integration files with v0.5.0-rc37 and restarted.
4. Reinstalled 0.4.8 over the migrated data, then reinstalled rc37.

## Results

| Check | Result |
|---|---|
| 0.4.8 baseline | Pass: domain loads; entry retries the unreachable robot. |
| Plan storage migration | Pass: migrated 1.5 to 1.11 at startup. Both plans keep their names, enabled state and rooms. The area keeps its name, mode, coverage and shape. Selections, room history and both rotation records are unchanged. The new containers are added empty. |
| Config entry migration | Pass: 1.2 to 1.3; options preserved. |
| Retired entities | Pass: the four duplicates (active cleaning session, update available, software version, hardware revision) are removed; other entities are kept. |
| Frontend | Pass: the Matic Map panel and icon assets are served (HTTP 200). |
| Errors | None from the integration other than the expected unreachable-robot retry. |
| Downgrade to 0.4.8 over 0.5 data | Fails closed: setup stops with "unsupported plan storage minor version 11". Plan storage is left byte-identical. |
| Reinstall rc37 after that downgrade | Pass: loads normally with data intact. |

Rolling back to 0.4.x therefore requires restoring a pre-upgrade backup. The
0.5.0 release notes say so.
