# Copy audit: every user-facing string (0.5 UX audit)

Scope: Map Studio panel, config and options flows, entities, exceptions, Repairs, services, blueprints and LLM tools, at base commit c00f878. Full scored list: `copy-corpus.tsv` (1,168 rows, one per string). Scoring follows the severity rules, codes and jargon denylist in `docs/ux-audit-0.5.md`. Nothing in product code was changed.

## Method

- Sources and corpus rows: `strings.json` 849 leaves = 849 rows; 90 Map Studio keys that exist only in TypeScript = 90 rows; 34 hard-coded notices and floor labels in `effects.ts` (37 sites); 4 other hard-coded fallbacks; 4 coverage-guard messages in `backend.ts`; Python exceptions 171 raise sites = 110 rows plus 12 LLM tool errors (identical text and key merge); `llm.py` 19 rows; blueprints 46 extracted lines = 40 rows (the 7-line notification message merges into one); 6 hand-added rows for dynamic or non-literal copy. The 473 `translate()` calls and 55 label/reason pairs map onto the `strings.json` rows (listed under "used" in `note`). services.yaml has examples only, no copy.
- Extraction was scripted (Python AST for raise sites and LLM text, a small TypeScript tokenizer for `translate()` calls and notices, JSON and YAML walks for the rest). Each row records where the text is shown (`key_or_location`) and, in `note`, where it is used.
- Each row got State / Consequence / Next-action digits (S/C/N: 1 present, 0 missing, - not needed), a severity, one principle code (HIG-Clarity, -Deference, -Depth, -ProgressiveDisclosure, -DirectManipulation, -Consistency, -Feedback) and contract codes where one applies (C-StateCopy, C-OneAction, C-EngCopy, C-Dialogs and so on).
- Severity: P0 misleads about robot state or safety, or is a dead end. P1 breaks a binding contract line or confuses a primary path. P2 is consistency or polish. P3 is a nit. Every P0 to P2 row has a proposed rewrite, and the builder fails if one is missing (0 missing).
- Meaning was checked in code before any rewrite. Where a rewrite depends on a code path (for example, which Bluetooth step re-pins the robot), the `note` cites the file and line.
- Blank severity means "no issue found". 706 rows are blank (CP-0321 is blank because its dialog is retired); 430 of them have no per-row note and were read in bulk after a jargon-denylist scan returned zero hits on them (0 unreviewed rows with denylist hits). A second pass over blank rows for terms scored elsewhere (cleaning system, stable ID, raw field names, interval) moved 23 rows to scored.
- `jargon_hits` is computed from the row's own text: denylist terms appear plain, other observed jargon is prefixed with "+" (managed, workspace, stable ID and so on). A term is listed only if the row says it.
- Rows for the 90 keys that exist only in TypeScript name the key in `key_or_location` (`file:line [key name]`), and their note says the key is missing from `strings.json` common.
- Rewrites follow the owner decisions: room-schedule progress shared across plans by default, an "Advanced:" prefix on developer services, a fresh Bluetooth re-pair for the identity-changed Repair, and wording that stays inside Home Assistant.
- Privacy: the corpus was scanned for IP and MAC addresses, long hex strings, e-mail addresses and home paths (0 hits). All examples are synthetic (Kitchen, Study).

## Totals

| Surface | Rows | P0 | P1 | P2 | P3 | Fine |
|---|---:|---:|---:|---:|---:|---:|
| map-studio | 552 | 0 | 10 | 78 | 77 | 387 |
| config-flow | 57 | 0 | 9 | 9 | 10 | 29 |
| options-flow | 26 | 0 | 1 | 12 | 5 | 8 |
| entity | 148 | 0 | 1 | 20 | 17 | 110 |
| exception | 147 | 0 | 7 | 42 | 65 | 33 |
| repair | 6 | 1 | 3 | 2 | 0 | 0 |
| service | 161 | 0 | 2 | 37 | 25 | 97 |
| blueprint | 40 | 0 | 3 | 2 | 13 | 22 |
| llm | 31 | 0 | 0 | 2 | 9 | 20 |
| **Total** | **1,168** | **1** | **36** | **204** | **221** | **706** |

The one P0 is the identity-changed Repair. 63 of the 65 exception P3 rows are Python or TypeScript literals (22 of them duplicate a `strings.json` message); where a translation key exists the UI shows the `strings.json` text, and the literal is what logs and API responses show.

## The 25 worst strings

Each line: corpus ID, severity, where it appears, current text, then the rewrite. Paired rows (abort/error variants, key/site duplicates) share one entry.

1. CP-0934 (P0) and its title CP-0933 (P1), Repair `robot_identity_changed`. Now: "...TLS certificate that does not match the pinned robot identity... re-pair it through Settings > Devices & Services > Matic Robot > Reconfigure." Dead end: every Reconfigure path re-checks the pinned certificate (config_flow.py:737, 827-833) and the pin is written only when the entry is created (config_flow.py:1126). Removing the entry is destructive: `async_remove_entry` (__init__.py:724-741) pops the robot's whole record from the plan store (plans.py:1614-1635), which holds plans, room settings, cleaning history, room schedule progress and custom areas (plans.py:4807-4815), and also deletes the saved map and history stores and firmware tracking. Rewrite: "The device at the robot's saved address no longer matches the robot Home Assistant was set up with, so Home Assistant has stopped talking to it. If the robot's address changed, open Settings > Devices & services > Matic (Unofficial), choose ⋮ on the robot's entry, then Reconfigure > Update robot address. If you replaced or factory reset the robot, delete the robot's entry from the same ⋮ menu, then add Matic (Unofficial) again and pair over Bluetooth. Deleting the entry removes this robot's saved plans, room settings, room schedule progress, custom areas, cleaning history and saved maps from Home Assistant, so note anything you want to recreate first." This rewrite is interim until the HA-REP-01 re-pair fix flow ships (the integration's display name is the manifest name "Matic (Unofficial)"; Reconfigure is in the config entry's ⋮ menu). Title: "Home Assistant can't confirm this is your robot".
2. CP-0670 (P1, Stop button). Now: "Stop plan and dock". The robot may keep cleaning the current room. Rewrite: "Stop plan (may finish current room), then dock".
3. CP-0816, CP-0903 (P1, `managed_run_changed`). Now: "The managed cleaning run has changed. Stop was not sent." Rewrite: "The cleaning plan changed before Stop could be sent, so Stop was not sent. Check the robot and press Stop again if it is still cleaning."
4. CP-0986 (P1, service Intelligent cleaning). Now: "Starts with the room least recently confirmed as the current cleaning area... lingering prior-room state... monopolizing later runs." Rewrite: "Cleans the rooms in a plan, starting with the ones that have waited longest, and keeps going until you stop it or every room is done. Rooms that were started but not finished stay due for the next run."
5. CP-1034 (P1, `save_plan` run behavior). Now: "...target-room-confirmed cleaning starts and shared opportunity history..." Rewrite: "Intelligent rotation cleans the rooms that have waited longest first; saved order breaks ties. Run all in saved order cleans every selected room from top to bottom."
6. CP-0197 (P1, panel). Now: "New cleaning is disabled until the live map is verified." Rewrite: "You can't start cleaning until the live map is ready."
7. CP-0254 (P1, disabled Clean button reason). Now: "Waiting for the current map to be verified." Rewrite: "Waiting for the map to be ready."
8. CP-0469 (P1, disabled Run plan reason; English only, no key). Now: "Room identity could not be verified. Check the current map before running." Rewrite: "Home Assistant can't match this plan's rooms to the current map. Check the map, then try again."
9. CP-0478 (P1, disabled Run plan reason; no key). Now: "A valid next-run preview is required before starting." Rewrite: "The plan's next-run preview has to load before you can run it. If it failed, use Retry preview."
10. CP-0433 (P1, room card; no key). Now: "Schedule identity does not match the current room map. Review this room before cleaning." Rewrite: "This room's schedule was set up on a different map, so it can't run. Review the room's schedule before cleaning."
11. CP-0240 (P1, Run plan reason). Now: "A room schedule has progress that cannot be verified. Reset the affected interval..." Rewrite: "Home Assistant can't trust the progress saved for a room schedule. Reset that schedule's progress in the plan, then run it again."
12. CP-0236, CP-0458, CP-0500 (P1, plan preview). Now: "...may need separate missions and dock visits", "Mission {number}", "New mission". Rewrite: "Rooms with different cleaning settings may be cleaned in separate parts, and the robot may briefly touch the dock between parts" (hedged as in llm.py:223-226, 554-556), "Part {number}", "New part (the robot may stop at the dock first)".
13. CP-0555, CP-0562 (P1, `bluetooth_unavailable` abort and error). Now: "...For Home Assistant Container, verify host BlueZ, /run/dbus, NET_ADMIN, and NET_RAW..." Rewrite: "Home Assistant can't use a Bluetooth adapter on this device, or it can only reach the robot through a Bluetooth proxy. Pairing needs an adapter attached directly to Home Assistant. Attach one, fix any Bluetooth issue listed under Settings > System > Repairs, then start setup again." Container detail belongs in docs.
14. CP-0557, CP-0564 (P1, `invalid_certificate`). Now: "The robot's identity could not be verified." Rewrite: "Home Assistant could not confirm this is your Matic robot, so it did not connect. Check that the address belongs to your robot, then start setup again."
15. CP-0558 (P1, `invalid_credential` abort). Now: "The robot rejected the saved local access." The abort is raised only in the first-setup pairing loop (config_flow.py:888-895), where no entry or saved credential exists yet; the reauth (:731) and update-address (:779) variants are inline errors. Rewrite: "The robot did not accept the pairing Home Assistant just set up. Turn Pairing mode off and on again in the Matic app, then start setup again."
16. CP-0572 (P1, `pairing_mode_off`). Now: "...could not find a Matic candidate... Reload Bluetooth or replug the adapter only if the local scanner also cannot see nearby Bluetooth devices; otherwise compare with a phone scan." Rewrite: "Home Assistant can't see the robot over Bluetooth. Move the robot within a few feet of the adapter, make sure Pairing mode is still on in the Matic app, then try again. Reload the Bluetooth integration or replug the adapter only if Home Assistant's Bluetooth scanner can't see any nearby Bluetooth devices; otherwise compare with a phone scan."
17. CP-0589 (P1, reset-pairing step). Now: nine sentences with "credential request", "bond" and the consequence mid-paragraph. Rewrite: "Home Assistant reused an earlier Bluetooth pairing and the robot rejected it. The saved pairing may be out of date, but other problems can cause this too, so resetting may not fix it. Choose only the robot you are setting up, using its Bluetooth name and address, and turn on Pairing mode in the Matic app first. Continuing removes that robot's saved Bluetooth pairing from this device and tries again with a new six-digit code. Restarting Home Assistant does not clear it. Cancel if you can't tell which robot to choose."
18. CP-0615 (P1, options menu). Now: "Edit saved plans and Areas in Map Studio at /matic-map... live workspace updates." "Map Studio" appears nowhere else for users. Rewrite: "Edit plans and custom areas on the Matic Map page in the sidebar. Here you can choose the default plan, reset cleaning history, or turn on live updates for that page. Saved plans: {plan_count}."
19. CP-0786 (P1, `area_map_changed`). Now: "...Open Configure and redraw it on the current map..." Configure opens the options flow, not the map. Rewrite: "This custom area was drawn on a different map. Open Matic Map, redraw it on the current map, then try again."
20. CP-0794 (P1, `invalid_plan`). Now: "The cleaning request is invalid: {error}". Six raise sites pass no `error` placeholder, so users can see a literal {error} (services.py:628, 664, 761, 833, 1183, 1263). Rewrite: "This request can't run. Check the plan, then try again. Details: {error}" (the placeholder goes last so no separator is needed whether or not the error ends with a period; also pass `error` at all six sites).
21. CP-0806, CP-0807 (P1, `room_interrupted`, `room_taken_over`). Now: "Cleaning in {room} ended without verified completion." / "The original cleaning task in {room} could no longer be verified. The plan was interrupted." Rewrite: "Cleaning in {room} stopped before the robot confirmed it was done. The room stays due for the next run. Check the robot, then start the plan again." / "Home Assistant could no longer confirm that the cleaning in {room} was the one it started, so the plan stopped. Check the robot, then start the plan again." (no cause is named: the code records cause "unknown", managed_executor.py:750-757).
22. CP-0787 (P1, `ambiguous_room_name`). Now: "Rename duplicate mapped rooms named {room} before using managed plans so completion can be verified safely." Rewrite: "More than one room on the map is named {room}. Rename them in the Matic app so each has a different name, then run the plan again."
23. CP-0932 (P1, Repair `firmware_regression`). Now: "...could not read {count} Hermes endpoint(s). The retained baseline is {previous} (protocol {previous_protocol})..." Rewrite: "Home Assistant repeatedly could not read {count} items from the robot on firmware {current}. The saved comparison is from firmware {previous}. A read failure does not prove a firmware problem. Open the Firmware compatibility sensor to see which items failed and whether the robot has recovered."
24. CP-0936 (P1, Repair `custom_area_map_changed`). Now: "...Their floor identity changed... Open Matic Map > Custom areas..." (no such label). Rewrite: "{count} custom areas need your attention. They were drawn on a different map, their saved data is damaged, or they no longer fit the current map. Home Assistant won't clean them until you fix them. Open Matic Map, choose Clean a custom area, and redraw each affected area." Needs plural handling.
25. CP-1127 (P1, blueprint Quiet-hours description). Now: "Start intelligent cleaning from a saved plan at a chosen time with an optional battery guard." The battery guard is not optional: the battery sensor input has no default (quiet_hours.yaml:16-22), the threshold defaults to 40 (:32-34) and the automation always checks battery level (:47-50). Rewrite: "Starts a saved plan at a time you choose, but only if the robot's battery is above a level you set (40% by default)."

Other P1 rows, all with rewrites in the TSV: CP-0199 (map canvas: "The private scene is not ready. No map data is shown until it is verified."; raised to P1 to match CP-0197, same state and same "verified map" family), CP-0569 and CP-0570 (Bluetooth recovery errors), and two blueprint rows: CP-1105 (picker card text) and CP-1115 (the phone notification tells a household admin to use the LLM tool name MaticGetFirmware).

## Recurring patterns

- "Verified" overuse: 58 rows contain "verif" (13 P1, 30 P2, 12 P3, 3 blank); 45 carry it as a jargon hit. It stands for three different things (map ready, saved data trusted, robot confirmed). Rewrite by meaning ("ready", "can't match", "confirmed"), and drop it where the user cannot act.
- Scope and "N cleans" phrasing: "Schedule scope", "every N cleans" with a literal N, "qualifying cleans", "cadence types", "interval" (6 rows with "Schedule scope" or "every N cleans", 9 containing "cadence", all P2). Use "Track progress", "once per this many cleans (1 to 100)" on the number field's label (no stand-in letter), "counted", "schedule", and one pair of scope labels everywhere ("This plan only", "Shared across plans (recommended)"). New schedules default to "this plan only" in code (workflow-panel.ts:354) although the owner decision is shared across plans; the rewrites label "Shared across plans" as recommended, and the default itself needs a code change.
- "Local access" as a noun: 4 rows (1 P1, 3 P2) in reauth and invalid-credential copy ("Restore local access", "Local access restored"). Say "pairing": "Pair Home Assistant again", "Pairing restored".
- Three names for one behavior: "Intelligent rotation" (selector, button, panel), "Intelligent cleaning" (service, blueprint, one history string), and "default plan" (entity buttons "Start default plan" and "Clean all rooms in default plan", beside the service "Clean entire plan" and the option "Run all in saved order"). One action, "Run plan", with a behavior of "Intelligent rotation (longest-waiting rooms first)" or "Saved order".
- Docker text in `bluetooth_unavailable`: BlueZ, /run/dbus, NET_ADMIN and NET_RAW shown to everyone whose pairing finds no usable local adapter, as an abort and as an inline error (CP-0555, CP-0562). Move to documentation.
- Observed jargon, denylist terms (rows): verified 45, native 22, session 11, cadence 9, identity 8, endpoint 8, mission 7, Hermes 6, revision 5, token 5, payload 3, OEM 2, fingerprint 2 (109 rows carry at least one). Not on the denylist but seen in the corpus (rows): managed 25, workspace 19, "stable ID" 12 (19 service rows use a "stable ... ID" phrase), intent 9, credential 8, adapter 8, scope 5, recheck 5, compatibility 5, scene 4, handoff 3, leg 3. Identity is the worst on user paths (8 rows, 6 of them P1); bond is in 2 P1 rows.
- Service field wording: "Cleaning system" for cleaning mode (7 rows now all P2, including CP-0980), raw field names as the whole description (CP-0950, CP-0960, P2), "clean-all command" (CP-0978, P2), and "stable ID" with no pointer to where IDs come from (19 rows: 18 at P3 plus CP-0978; point to List cleaning plans).
- Same text, different words in different layers: 14 keys have a TypeScript fallback that differs from `strings.json` (for example "Delete plan" versus "Delete"), so the wording depends on whether the translation loads.
- Missing next action: CP-0478 names a requirement but no action (C-OneAction); abort texts such as `invalid_certificate` and `invalid_credential` state a problem and end the flow without a next step.

## Proposed glossary (one term per concept)

| Concept | Use | Avoid |
|---|---|---|
| The device | robot ("Matic" only in "Matic app", "Matic (Unofficial)" and "Matic Map") | device, unit, vacuum |
| The sidebar page | Matic Map | Map Studio, workspace |
| Map | map; floor for one level; saved map in history | floor plan, scene, live workspace |
| A space on the map | room | zone, routine room, task area |
| A drawn space | custom area | Area (capitalised), outline (for the shape only) |
| Saved list of rooms | plan | routine, task, cleaning system, sequence |
| One execution | run | mission, managed run, session |
| A stage of a run | part ("Part 2") | mission, leg |
| How often a room is mopped | room schedule; progress | cadence, interval, scope |
| Run behavior | Intelligent rotation (longest-waiting rooms first), Saved order | Intelligent cleaning, Run all |
| Charging base | dock | base, station, dock visit |
| Bluetooth link | pairing; Pairing mode (in the Matic app) | bond, credential, local access, authorization |
| Software cannot tell | "Home Assistant can't confirm/match..." | verified, identity, authoritative |
| Robot data checks | robot data check, item | Hermes endpoint, payload, fingerprint |
| Developer services | name starts "Advanced:" | unprefixed |

Style: sentence case, verb-first buttons, placeholders instead of concatenation, state then consequence then next step for every error.

## Key drift

- 90 `v4_*` keys are used in TypeScript but absent from `strings.json["common"]` (of 386 distinct `v4_*` keys the code uses). They display English TypeScript fallbacks only; two methods agree.
- 68 `common` keys are never passed to `translate()` (65 if you also exclude three whose names are workflow or mode values: `coverage`, `draw`, `map_session_unverified`).
- 28 hard-coded notice literals in `effects.ts` (3 constants, 17 `notice.text`, 8 plan and schedule success or failure strings), plus 6 floor-label sites. `effects.ts` has 0 `translate()` calls.
- `translations/en.json` is byte-identical to `strings.json`: true (`cmp` clean, 849 leaves).
- Also found: 14 keys with a differing TypeScript fallback (18 call sites); 3 exception keys raised but missing from `strings.json` (`cadence_reset_blocked`, `invalid_plan_command`, `plan_locked`); 1 `strings.json` exception key with no raise site (`plan_not_running`; the four `coverage_*` keys are raised dynamically from vacuum.py:383); the four coverage-guard messages exist in three places (exceptions.py, `strings.json`, backend.ts); six `invalid_plan` raise sites omit `{error}`.
- Unverified: whether the panel can read `common` translations at runtime. No `loadBackendTranslation` call exists in the repo, so the English fallbacks may be what users see.
