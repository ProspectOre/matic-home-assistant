# Plan picker, Run and Edit audit resolutions

Retained audit resolutions for the [Plan picker, Run and Edit specification](plan.md).
Section numbers refer to that specification.

| Audit ID | How this spec resolves it |
|---|---|
| MS-PLANS-01, MS-PLAN-04, MS-PLAN-16 | A picker row or the home card opens Run: the plan name as title with a plain back chevron, then the next run with settings and the due lines, and one Run plan button. Edit is secondary; rows get a chevron. |
| MS-PLANS-02, MS-PLAN-09 | A notice slot sits under every h2. The picker shows a toast after Delete; Save, Run plan and the Run switch get visible inline feedback in the current view, at 390 and 1024 alike (§4). |
| MS-PLANS-03, MS-PLANS-04 | Create becomes the last, secondary row (filled only when the list is empty). Rows show room count, order, a Default chip, and either "Paused" or the due lines / "Needs attention". |
| MS-PLANS-05, MS-PLAN-10 | The picker and Run open at half and Edit at full. On a landscape phone all three open at full with the bar on screen (§7). Known partial: at 844×390 a one-line notice leaves one content row at full height (two at 768×432); the formula stays `design-system.md` §7's. |
| MS-PLAN-01 | The disabled reason names the room and the fix and links to it, and the room row is badged (R3, §6). |
| MS-PLAN-02, MS-PLAN-18 | A segmented order control. Numbers and arrows, in the list and on the map, appear in Saved order only. |
| MS-PLAN-13 | End arrows stay in place, `aria-disabled` with a reason, styled per MS-STATUS-09 (`design-system.md`). |
| MS-PLAN-05 | The per-part caption goes; parts show as dividers plus `v4_room_parts`. |
| MS-PLAN-06 | Map taps change rooms only in Edit, and unticked rooms keep their settings until Save. |
| MS-PLAN-11 | Covered by MS-DS-01 (`design-system.md`) for Run plan, Save and Create. |
| MS-PLAN-12, MS-PLAN-19 | An "Unsaved changes" chip, sticky Cancel and Save, and Delete in the overflow, disabled while edited. |
| MS-PLAN-15 | By ruling (R5), this departs from the audit direction "Move both under More options" (map-studio-tasks.md:83). "Plan enabled" leaves the form and becomes Run's switch, below the next-run list and applied at once. The CP-0382 hint becomes its description. The picker's "Paused" chip and the Run plan reason keep "off" visible at the top. |
| MS-PLAN-17 | Edit never shows a next-run section; Run shows it after Save. |
| MS-PLAN-20 | Switch knobs use the logical translate (`design-system.md`). |
| MS-PLAN-22 | "Heavy duty" (CP-0062). |
| MS-KEY-01 | Plan side: backward moves restore the picker row, the home plan card or the Edit button, and Back goes to the origin (§5). |
