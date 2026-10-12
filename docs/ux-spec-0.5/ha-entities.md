# HA-native entities, actions, blueprints, LLM tools: redesign spec (0.5)

Phase B spec for what Home Assistant lists about the robot: entities and the device, actions, five blueprints, the LLM tools and automation events. Flows and Repairs are in `docs/ux-spec-0.5/ha-native.md`. Audit: `docs/ux-audit-0.5/ha-native.md`, `copy.md`, `copy-corpus.tsv`; "CP-nnnn" means that row's `proposed_rewrite` is final text unless a row here overrides it, and `docs/copy-style-0.5.md` wins over both. Cites are to base `c00f878`. Keys, unique_ids, entity_ids, action and tool identifiers and policy stay; names, copy, defaults and section 9 change.

## 1. Scope
- Surfaces: entities and device (name, model, defaults, classes), firmware update entity, actions (`services.yaml`, `strings.json`, `icons.json`), five blueprints, two LLM APIs, automation events and device triggers. No flows or Repairs (`ha-native.md`), no Map Studio (`ms-*`).
- Audit IDs (27): HA-ENT-01, -02, -03, -04, -05, -06, -07, -08, -09, -11; HA-SVC-01, -02, -03, -04, -05, -06, -07, -08; HA-BP-01, -02, -03, -04, -05, -06; HA-LLM-01, -02, -04 (full IDs in section 11). The other 25 IDs (HA-FLOW, HA-OPT, HA-REP) are in `ha-native.md`.
- Owner decisions touched: entities renamed and duplicates removed with stable unique_ids and entity_ids; "Advanced:" prefix on developer actions; Stop stays unconfirmed.

## 2. User goal
A household administrator builds automations and dashboards on Matic (Unofficial) from Home Assistant's pickers. In two seconds each entity, action, blueprint and event reads as one plain thing about the robot, and a pending firmware update is visible.

## 3. Hierarchy
1. Device page (HA's order: controls, sensors, Diagnostic): buttons Run plan, Run intelligent rotation, Run saved order, Stop cleaning; sensors; Diagnostic entities, with the rarely useful ones off by default.
2. The Stop button entity (`stop_intelligent_cleaning`) stays enabled and unconfirmed with the same `unique_id`; only its name changes. The Stop action has the same name.
3. Actions picker (HA sorts by name): developer actions all start "Advanced:", so they list together and are recognisable.
4. Blueprints: five, each with an import badge, "Matic: <verb phrase>" names and a described input per field.
5. LLM: two APIs, administrators only, reachable from Assist conversation agents and from Home Assistant's MCP server (2026.10 exposes every LLM API by default). Events: 15, each with a plain name beside its event type.

## 4. States (HA entity and picker states; "branch" is not a `state.ts` step)
| State | What the user sees | Primary action → source (line) | Secondary | Notice/feedback |
|---|---|---|---|---|
| Firmware update pending | Update entity "Firmware" shows update available, "Newer than {installed}" version (`pending_firmware_version`; "Newer firmware" when the installed version is unknown), summary | none; read-only → `update.py:72-86` | Home Assistant's Skip only (no install; see §10 build decisions) | the robot installs updates itself |
| Firmware check status | Checking / Checks recorded for comparison / Compatible / Some robot reads are failing / Up to date | none → `sensor.py` | Repair link (`ha-native.md`) | state and Repair title share one phrase |
| Stop pressed | Button "Stop cleaning", no dialog | Stop cleaning → `stop_intelligent_cleaning` | none | description says what happens to the current room (CP-1004) |
| Upgrade, removed entity used | Automations referencing a removed entity show it unavailable | replace per table in section 6 | none | release note lists the four replacements |
| Action form | Everyday actions plain; "Advanced:" actions carry hint-first descriptions and `advanced` ID fields | per action | none | no raw field names |
| Blueprint run | Runs only when its listed conditions hold (docked or idle, battery guard, once a day for pets) | trigger | trace shows the skipped condition | notification links the device page |
| LLM, administrator / other | Status tools and firmware-research tools / no tools and a one-line prompt | n/a | n/a | other users get plain words, not an exception |

## 5. Interaction
- Stop and Advanced actions open no dialog; a rename never changes an entity_id, so dashboards and automations keep working. Reversible: all renames and defaults (enable an entity again). Not reversible: the four removals (restore by downgrading).
- Removals run once on first load of 0.5 through a registry cleanup, not on every start; replacements are in the table below.
- Blueprint rules: a member is away when their state is not `home`, `unknown` or `unavailable`, so a named zone counts as away (template trigger with `for`, same test in the condition); Pet-aware, Quiet-hours and Scheduled run only when the robot is docked or idle; Pet-aware runs at most once a day (skips if `last_triggered` is today); Firmware asks only for the firmware check sensor and derives the robot from its device.
- LLM: a non-administrator or missing user gets no tools and a prompt line instead of an exception (`llm.py:40,205-215`); tool identifiers keep.

## 6. Final copy
In sentences the robot is "the robot" and "Matic" stays a brand prefix: device fallback "Matic (Unofficial) {suffix}", the LLM API names and "Matic:" blueprint names, per `docs/copy-style-0.5.md:33`.

### Entities (names only; keys and unique_ids unchanged)
| Key | Final name and states | Class · category · default | Change |
|---|---|---|---|
| `activity`, `wifi_state`, `update_state`, `firmware_compatibility`, `cues_voice_status`, `cues_gesture_status` | names keep, but `firmware_compatibility` is "Firmware check status" (CP-0719); states CP-0700-0707, 0720-0724 ("Checks recorded for comparison", "Some robot reads are failing", "Up to date") | ENUM with `options` (7, 6, 6, 5, 6, 6); all but `activity` diagnostic; `wifi_state` off by default (audit), the rest on | add class and `options` (`sensor.py` has none) |
| `current_area`, `cleaning_history`, `last_run_duration` | Current room; Rooms cleaned by plans; Last clean duration | none · none · on | rename (entity_ids unchanged) |
| `coverage_time`, `scheduled_cleanings`, `local_cleaning_sessions` | Coverage time; Scheduled cleanings; Robot cleaning runs | DURATION (`UnitOfTime.SECONDS`, was "s") · diagnostic · off | class, category |
| `update_channel`, `protocol_version`; `paused`, `returning`, `fully_charged` | keep | diagnostic · off; none · off | off by default (the last three repeat Activity) |
| `ssh_tunnel_permission`, `diagnostic_upload`; `water_flow`; `voice_assistant` | Support tunnel permission; Diagnostic upload; Mopping water flow (unit "×"); Cues voice assistant | diagnostic · off; CONFIG · on | rename (drops "Robot", "SSH", the doubled device name); tests pinning "Robot ..." names change (`copy-style-0.5.md:119`) |
| buttons `run_selected_plan`, `intelligent_clean`, `clean_entire_plan`, `stop_intelligent_cleaning` | Run plan; Run intelligent rotation; Run saved order; Stop cleaning | as today | CP-0667, 0670; CP-0668/0669 shortened to 3 words (`copy-style-0.5.md:88,119`); each button has its action's name (§6 `services`); descriptions say "default plan" and the stop policy |
| `firmware` (update) | Firmware; `latest_version` "Newer than {installed}" (translated `common` key `pending_firmware_version`; `pending_firmware_version_unknown` "Newer firmware" without an installed version) while `update_state == "available"` (`update.py:72-86`); `release_summary` "The robot installs firmware updates itself; Home Assistant only reports that one is waiting." | FIRMWARE · on | read-only; `tests/test_entities.py:998-1053` and `entities.md` change |
| device; dust-bag strings | name fallback "Matic (Unofficial) {suffix}" (suffix = last 4 hostname characters, `entity.py:26-28`), model see Decision 2; `bag_full`, `bag_missing` strings and icons deleted, four bag sensors stay unregistered (`sensor.py:101-134`) | n/a | HA-ENT-06, HA-ENT-07 |

Removed entities (one-time registry cleanup; Decision 3):
| Removed key | Use instead |
|---|---|
| `active_cleaning_session` ("Cleaning run in progress", CP-0653) | Cleaning (`cleaning`) |
| `update_available` | Firmware update entity (`update.firmware`) |
| `software_version` | device `sw_version` (`entity.py:30-32`) |
| `hardware_revision` | device `hw_version` (`entity.py:29`) |

### Actions, blueprints, LLM, events
| Key | Final text | S/C/N | Note |
|---|---|---|---|
| `services.<k>.name` | Run plan (`run_selected_plan`); Run intelligent rotation (`intelligent_clean`); Run saved order (`clean_entire_plan`); Stop cleaning (`stop_intelligent_cleaning`, same as the button); Reset room cleaning history (`reset_plan_history`, no CP row); Advanced: Inspect robot data; Advanced: Record firmware snapshot; Advanced: Choose firmware investigator; Advanced: Update firmware notification | N | CP-0985, 0989, 0993, 0670 (CP-1003 "Stop plan" overridden by `copy-style-0.5.md:119`), 1077, 1083, 1085, 1089; other 13 names keep; plan-editing actions are not prefixed |
| `services.*.description`, `.fields.*` | CP-0950-0966, 0978-0980, 0986, 0994-1008, 1016-1021, 1034, 1042, 1078-1094 verbatim, except CP-0950 and CP-0960 drop the bracketed field names; `fields.plan`: "Plan name or ID. Leave empty to use the default plan. Find IDs with List cleaning plans." (required ones drop the second sentence), `example: Main floor` | SCN | no raw field names, no "stable ID"; text stays because `services.yaml` cannot list plans |
| `rooms` / `room` objects (`services.yaml:33,53,184,254`), `advanced: true` | `fields` Room, Cleaning mode, Vacuum coverage with `multiple: true` on the three list fields (stored shape unchanged); `advanced` on `preview_token`, `expected_run_id`, `plan_id`, `revision` | N | beside `start_timeout`, `completion_timeout` |
| `selector.*` | `cadence_scope`: In this plan only / Across all plans (recommended); `run_behavior`: Intelligent rotation (longest-waiting rooms first) / Saved order; NEW `schedule_type`: Mopping / Vacuum rotation; NEW `firmware_notification_action`: Acknowledge / Mark as delivered / Check again; NEW `robot_data_item`: plain label per the 40 keys (5 words max, no wire names) | N | CP-0937-0946 |
| `icons.json` services | clean robot-vacuum; clean_area vector-square; clean_room_sequence and clean_entire_plan format-list-numbered; preview_room_sequence and preview_plan eye-outline; intelligent_clean sort-clock-ascending-outline; run_selected_plan play-circle-outline; stop_intelligent_cleaning stop-circle-outline; reset_plan_history history; reset_room_cadence calendar-refresh; list_plans format-list-bulleted; save_plan content-save-outline; delete_plan delete-outline; select_plan playlist-check; plan-room actions plus-box-outline, minus-box-outline, swap-vertical; four Advanced wrench-outline | n/a | entity `intelligent_clean` icon brain becomes sort-clock-ascending-outline |
| Blueprint titles | Matic: Clean when everyone leaves; Matic: Clean during quiet hours; Matic: Clean after pets leave; Matic: Clean on a schedule; Matic: Send firmware alerts. `automation.md` matches; file names stay for import URLs. Descriptions CP-1099, 1105, 1121, 1127, 1134; notification body CP-1115 | SCN | `copy-style-0.5.md:122` (colon, no dash); notification links the device page, never a tool name |
| Blueprint inputs | `vacuum` "Robot"; `plan` "Plan" (Name of a plan saved in Matic Map, for example Main floor. Leave empty to use the default plan.); `settle_time` "Delay before cleaning" (How long everyone must be away before cleaning starts.); `battery` "Battery sensor" and `minimum_battery` "Minimum battery" (Optional. Skip cleaning when the battery is at or below this level.); `notification_namespace` "Notification ID prefix" (Use a different value on each Home Assistant server so notifications don't replace each other.) | N | all 20 inputs get a description; CP-1100 by `copy-style-0.5.md:123`, whose plan input stays a typed name (D4); a blank plan omits the `plan` key via a `data` template |
| LLM API and text | "Matic: Robot status (administrators only)" (`matic_robot_operations`, six read-only tools) and NEW "Matic: Firmware research (administrators only)" (MaticGetFirmware, Claim, Complete). Non-admin or no user: no tools and prompt "These tools are only for Home Assistant administrators. Ask an administrator."; error "Only a Home Assistant administrator can use the robot tools." Prompt opens "Answer in plain words (robot, room, plan, cleaning run) and do not repeat internal terms."; tool descriptions CP-1154-1168 without the internal terms listed in the Note; errors become `llm_*` `translation_key` exceptions | SCN | terms removed from tool descriptions: mission, leg, native, runner lock, reconciliation marker, opaque keys, allowlisted, payload; API names are brand-prefixed (`copy-style-0.5.md:33`); sentences say "the robot"; `llm.py:40,205-215` |
| AI surfaces (HA 2026.10) | Robot status gains write tools behind the same `state.ts` selectors and command path as the panel: MaticRunPlan (plan name or default), MaticCleanRooms (room names, cleaning mode), MaticStopCleaning, MaticResetSchedule (room, schedule type, scope); each confirms the policy reason in plain words when it refuses (same reasons as the strip). Tools return `ToolResult` with tool metadata (as `vacuum` and `climate` do) and declare `integration`; `async_get_tools` returns the Robot status tools so Assist agents get them (Firmware research stays MCP-only). Prompt and tool descriptions follow `copy-style-0.5.md:117-124`. `hacs.json` minimum 2026.10; tests run against 2026.10 | SCN | `llm.py:912` returns None today; KNX (#178029) is the reference adoption; MCP server defaults: expose all APIs (#183054), admin-only option (#180713), `ToolResult` (#182487), tool metadata (#182614), required integration (#182714) |
| Events (`automation.md`) | all 15, event type beside each plain name, with fields: Room started, finished, failed, cancelled, stopped early, ended unconfirmed, confirmed late (`room_*`, incl. `room_reconciled`: `entity_id`, `plan_id`, `room_id`, `room`, `run_id`, `reason_code`, `cause`); Plan finished (`entity_id`, `run_id`, `outcome`, `reason_code`, `cause`); Plan docked; Cleaning finished (`device_id`, `entry_id`, times, `rooms`); Firmware changed, checked, report updated; Cues activity; Robot activity recorded (`activity_observed`) | N | device triggers: Room finished, Plan finished, Cleaning finished; Download diagnostics path in `activity-diagnostics.md`, `privacy.md:52` |

## 7. Responsive
Entities, actions and blueprints render in Home Assistant's own pickers, cards and editors, which already reflow from 320 to 1440 (full-screen dialogs on phones incl. 844x390 landscape, cards from 600). This spec adds no layout; keep names to 4 words (buttons 3) and descriptions to two sentences so nothing truncates at 320, and put long help in field descriptions, not names.

## 8. Accessibility
HA supplies 44 px targets, focus order, forced colors and reduced motion; add none. ENUM sensors give automation editors labelled pick lists instead of free text; DURATION lets HA read "2 hours 5 minutes" aloud; names are noun phrases or verb-first for screen readers; no colour-only state. Placeholders and numbered text let translators reorder and RTL mirror.

## 9. Backend needs
| Need | Owner |
|---|---|
| backend need: ENUM `options`, DURATION, categories, defaults, renames, device name fallback and model, update `latest_version`, removals plus one-time registry cleanup, deleted bag strings | `sensor.py`, `binary_sensor.py`, `number.py`, `update.py`, `entity.py`, `migrations.py`, `strings.json`, `icons.json` |
| backend need: action names, `advanced`, object `fields`, translated selectors, `fields.plan` hint and example | `services.yaml`, `strings.json`, `icons.json` |
| backend need: five blueprints (titles, 20 input descriptions, optional battery, derived robot, docked-or-idle and once-a-day conditions, import badges), name-to-ID table, events table, diagnostics path | `blueprints/automation/matic_robot/*.yaml`, `docs/automation.md`, `docs/entities.md` |
| backend need: two LLM APIs, empty tool set for non-administrators, `llm_*` exceptions, four write tools on the panel's command path, `ToolResult` and metadata, `async_get_tools`, 2026.10 minimum; device triggers (room events and plan finished match `entity_id`, cleaning finished matches `device_id`) | `llm.py`, new `device_trigger.py` |
| backend need: update tests that pin the broken update state and the "Robot ..." names | `tests/test_entities.py:988-990` and name tests |

## 10. Decisions needed
1. **LLM split.** Moving Claim and Complete into a second API changes agents that selected "Matic operations". Recommended: split now (pre-stable) and keep MaticGetFirmware in both.
2. **Model string.** No source reports a model (`client/models.py:10-22`). Recommended: model "Robot" and no `model_id` until the robot reports one.
3. **Removed entities: release-note mechanics only.** Already decided (duplicates are removed, owner decision). Remaining: remove on first load, list the four replacements in the release note, no deprecation Repair. Recommended as written.
4. **Blueprint plan input.** The guide (`copy-style-0.5.md:123`) keeps a typed name with a description, an example and a blank-valid default (blank means the default plan), because the plan select entity holds one robot-wide selection (`select.py:103-145`) and a picker cannot express a different plan per automation. Recommended: as the guide says; the alternative is a default-plan-only blueprint, which would change the guide's UX1 check.
5. **AI surfaces.** 0.5 ships read-only tools that only an MCP client sees. Recommended: adopt 2026.10 natively as the row above says; write tools are administrator-only and fail closed through the same selectors, so an agent can never do what the panel would refuse.
- **Owner decisions (2026-10-11):** all recommendations accepted. D1 split the LLM API now, MaticGetFirmware in both; D2 model "Robot" and no `model_id`; D3 remove on first load, list the replacements in the release note, no deprecation Repair; D4 the blueprint plan input stays a typed name as the guide says. **(2026-10-12):** D5 AI surfaces accepted as recommended.
- **Build decisions (UX0, 2026-10-12):** the pending `latest_version` is the translated `common` key `pending_firmware_version` "Newer than {installed}" (or `pending_firmware_version_unknown` "Newer firmware" without an installed version), read from Home Assistant's translation cache. It changes when the installed version or the language changes, so a Skip lasts until the robot installs firmware (a second pending update before then stays skipped) or the language changes; with no installed version it stays "Newer firmware" and the entity's state is unknown.

## 11. Resolves
| Audit ID | How this spec resolves it |
|---|---|
| HA-ENT-01, HA-ENT-02 | firmware update shows a pending update; `update_available` removed with a replacement (HA-ENT-02 is P2) |
| HA-ENT-03, HA-ENT-07, HA-ENT-11 | duplicates removed or off by default; orphan bag strings deleted; version sensors removed with replacements |
| HA-ENT-04, HA-ENT-05, HA-ENT-06, HA-ENT-08 | ENUM, DURATION, device name and model rules; name-to-ID table in `entities.md`, IDs kept |
| HA-ENT-09 | events table, device triggers, diagnostics click path |
| HA-SVC-01, HA-SVC-02, HA-SVC-03, HA-SVC-04, HA-SVC-05 | "Advanced:" prefix; translated pick lists; plan hint and example; object `fields` |
| HA-SVC-06, HA-SVC-07, HA-SVC-08 | one verb and glossary names on action and button, Stop action and Stop button both "Stop cleaning" (CP-0670); `advanced: true`; service icons |
| HA-BP-01, HA-BP-03, HA-BP-04 | zone-aware away rule, docked-or-idle condition, optional battery guard, derived robot |
| HA-BP-02, HA-BP-05, HA-BP-06 | every input described, blank plan valid, one label, matching titles, import badges |
| HA-LLM-01, HA-LLM-02, HA-LLM-04 | non-admin gets an empty tool set; scope in the name and firmware-research split; translatable exceptions |

## 12. Invariants kept / out of scope
- Kept: local-only operation, administrator-only Matic Map and LLM tools (write tools included), unique_ids and entity_ids, action and tool identifiers, Stop reachable without confirmation, policy in `state.ts`.
- Out of scope: robot-model detection, enumerating the 40 `robot_data_item` labels (rule only, Advanced), any `ha-*` or `mwc` rewrite. Cannot verify here: that HA's picker sorts "Advanced:" actions as described and that the update entity renders `latest_version` as designed (frontend, not exercised).
