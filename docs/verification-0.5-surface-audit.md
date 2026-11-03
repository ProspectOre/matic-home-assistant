# Matic 0.5 whole-integration evidence audit

The October 26 surface audit supporting [0.5 stable qualification](verification-0.5-stable.md).
Its remaining proof is version-bound; later owner limits and release decisions
remain in the qualification record.

The owner requested proof across the complete shipped surface on October 26.
The inventory is 54 fixed entities plus two statistics sensors per mapped room,
23 integration services, 13 distinct assistant tools across two APIs, five
blueprints, and 18 documented event families including three device triggers.
Registration, a screenshot, or an underlying service test does not establish
every entity route or downstream automation. Dust-bag sensor descriptions are
not registered and are not part of the shipped entity count.

| Surface | Remaining end-to-end proof |
| --- | --- |
| Entities and direct actions | Native Core registration/dispatch checks cover all five buttons, plan/area and preference selects, vacuum commands, four switches and water-flow validation with an inert client. Button destinations use local service sinks. Real transport/physical effects and positive diagnostic/error/Cues transitions remain open. |
| Room statistics | Recorder history and native restore-store serialization/reload preserve duration and timestamp values with no room history available; seconds remain native while minutes remain displayed. This is a disposable Core check, not a full host/database restore drill. |
| Timing and schedules | Retained estimates match room, mode, and coverage in source; broader setting combinations and every cadence/recovery combination are not physically qualified. Latest room-statistics sensors are not separate settings tiers. |
| History reset | Populated encrypted-backup migration/reset passed in a disposable instance: only the target history was cleared, 45 other histories survived reload. No production history reset or full backup-restore drill is claimed. |
| Blueprints and triggers | Five native import/save/reload checks exercise actual state/time/report triggers against local sinks. A composed native tracker-to-saved-blueprint check verifies retry and quiet delivery behavior. Three device-trigger automations survive save/reload and stop after deletion. Synthetic firmware scans do not establish a real firmware transition. |
| Assist and notifications | Native Assist reads, owner-confirmed microphone/speaker use and direct Run plan passed. Real iPhone Check again/Acknowledge events completed through the current saved blueprint, and the owner confirmed notification clearing. Model-selected physical writes and actual firmware-transition alert delivery remain separate. |
| Pairing and firmware | Spare-robot, helper, multi-robot, foreign/revoked credentials, identity recovery, and actual firmware transition/alert lifecycles retain hardware or configuration prerequisites. |
| Reliability and accessibility | Live setter fault/reconnect cases, low-charge recovery, complete assistive-technology coverage, all-device endurance, and a matching-backup restore drill are not established. |

These are evidence gaps unless reproduced as defects. They are not silently
excluded from the owner's expanded request. Reuse applicable completed tests;
exercise missing behaviors rather than rerunning the entire historical matrix.
