# Copy style guide (0.5)

Rules for every string a household member can read. Inputs: `docs/ux-audit-0.5/copy.md` and `copy-corpus.tsv` (CP ids below), the Product authority paragraph in `docs/architecture-0.5.md`, and Home Assistant conventions. **Precedence:** this guide wins over the rewrites in the TSV, which is the finding list, not final copy. UX1 rewrites conform to the guide; examples marked "(shortened to the guide)" differ from the TSV for that reason. The checklist at the end is the review gate.

## Purpose and scope

One voice for every human-readable string: the Matic Map panel and its TypeScript fallbacks, config and options flows, entity and attribute names, actions, Repairs, blueprints, LLM tools, exceptions that reach the UI, and release notes. Log lines are exempt, but must not contradict the words used here. Binding owner decisions, not open to rewording:

- Stop never asks for confirmation. Its consequence is stated in the status line once Stop is accepted.
- Room-schedule progress is shared across plans by default ("Across all plans"); the other choice is "In this plan only". The code still defaults to counting in this plan only and UX3 flips it, so copy written now describes the new default.
- Developer actions are named with an "Advanced:" prefix.
- A robot that no longer matches the one Home Assistant was set up with is recovered by a fresh Bluetooth pairing. Copy never offers to skip, accept or relax that check.

## The three-part rule

Copy that reports a problem or gates an action gives, in this order: **state** (what is true now, in household words), **consequence** (what it stops or erases, when not obvious), **next action** (one thing to do now). Labels need none. Errors need all three. Disabled reasons need the cause and the fix. Internal bookkeeping terms stay internal (see the denylist table).

| CP | Before | After | What changed |
|---|---|---|---|
| CP-0808 | The robot's room map is unavailable. | Home Assistant doesn't have the robot's room map right now. Check that the robot is online and has a current map, then try again. | Adds who can't see it, and the next action |
| CP-0478 | A valid next-run preview is required before starting. | Can't run this plan until you retry its next-run preview. | Disabled reason is one sentence with its fix (shortened to the guide) |
| CP-0794 | The cleaning request is invalid: {error} | This request can't run. Check the plan, then try again. | Consequence and action added (shortened to the guide); see Errors and aborts for the `{error}` detail line |
| CP-0902 | The saved-plan resolution changed before starting | The plan changed after you previewed it. Preview it again, then run the plan. | Cause in plain words, actions in order; "run" per the glossary (conformed to the guide) |
| CP-0629 | Submitting clears rotation history for {plan_name}. Saved plans and their settings remain. Turn on the option below to reset history for every plan. | This clears which rooms {plan_name} has already cleaned, so the next run starts over. Your plans and their settings are kept. | Says what is lost and what is kept (shortened to the guide) |
| CP-0786 | This custom area was saved for a different room map. Open Configure and redraw it on the current map before cleaning. | This custom area was drawn on a different map. Open Matic Map, redraw it on the current map, then try again. | The named place is the one that works |

## Vocabulary

One term per concept. Use the "Use" column everywhere, including code comments that become copy.

| Concept | Use | Also avoid |
|---|---|---|
| The device | robot; "Matic" is a brand prefix on names (Matic app, Matic (Unofficial), Matic Map, "Matic: {name}" blueprints), never the noun for the robot in a sentence | device, unit, vacuum, "Matic robot", "the Matic" |
| Home Assistant | Home Assistant, spelled out; paths as "Settings > Devices & services" | HA, arrows in paths |
| One level / its picture | floor / map; "saved map" in history | floor plan |
| Space on the map | room | zone, task area |
| Space the user draws | custom area (lower case) | Area, outline (the shape only) |
| Saved list of rooms | plan | task, sequence |
| One execution / a stage of it | run / part ("Part 2") | job |
| Run behavior | Intelligent rotation (longest-waiting rooms first), Saved order | Intelligent cleaning, Run all |
| Run actions | Run plan (saved plan), Clean {count} rooms (one-time clean) | Start default plan, Clean entire plan |
| How a room is mopped over time | room schedule; progress; "counted" | recurrence |
| Where progress counts ("Count cleans") | Across all plans (default, recommended), In this plan only | per-plan, global |
| How the robot cleans | cleaning mode | mode of operation (and the denylist term) |
| Vacuum rotation and vacuum coverage | "vacuum rotation" is a room's "{Level} vacuum every N cleans" schedule ("Heavy duty vacuum every {count} cleans"); "vacuum coverage" is a room's level setting (Quick, Optimal, Heavy duty). They share the level names and are never swapped; the work itself is named by its level ("Heavy duty vacuum due in Kitchen") | "coverage" for the schedule, "rotation" for the room's level |
| Charging base | dock | base, station |
| Bluetooth link to the robot | pairing; Pairing mode (a Matic app control, written as shown) | link, connect, authorization |
| The sidebar page | Matic Map | Map Studio, workspace, the panel |
| Software cannot tell | "Home Assistant can't confirm {thing}" or "can't match {thing}" | can't trust, invalid, illegal |
| Robot data checks | robot data check, item | ping, probe, poll |
| Developer actions | name starts "Advanced:" | unprefixed |

**Denylist.** Never shown to users. Matching is whole-word plus plural `s`/`es` (`\b<term>(s|es)?\b`, case-insensitive) and the `verif\w*` family; other inflections ("rechecked") are not caught, so reviewers still read. It merges the audit rubric terms with jargon observed in the corpus and the terms the existing test checks.

| Never write | Say instead | Seen in |
|---|---|---|
| mission, leg, dock visit | run; part; "the robot may stop at the dock" | CP-0236, CP-0458 |
| generation | drop it; "map update" or "latest map" | rubric |
| profile, section, round-robin | setting or cleaning mode; room; Intelligent rotation | existing test |
| session, managed, managed run | run; drop the word; plan | CP-0838, CP-0903 |
| verified (and every word matching `verif\w*`), identity, authoritative | ready; "can't match"; "can't confirm" | CP-0254, CP-0469 |
| cadence, interval, qualifying, schedule scope | room schedule; progress; counted; "Count cleans" | CP-0438 |
| endpoint, payload, fingerprint, SHA-256, wire-shape, Hermes | robot data check; item; checksum (Advanced only) | CP-1078, CP-1084 |
| token, revision, ledger, epoch, goal ID, stable ID | ID or version, with where to find it (Advanced only) | CP-0997, CP-1094 |
| native, OEM | the robot's own stop; drop the word | CP-0829 |
| coherence, reconciliation, runner lock, opportunity, handoff, recheck, scene | plain state ("busy", "waiting"); map; check again | CP-0199, CP-0511, CP-0550 |
| credential, bond, local access | pairing; pair again | CP-0589 |
| pinned, certificate, TLS | "can't confirm this is your robot" | CP-0934 |
| workspace, Map Studio, routine, cleaning system | Matic Map; plan; cleaning mode | CP-0615, CP-0930, CP-0390, CP-0980 |
| intent | command | CP-0769 |

Allowed only in Advanced actions, their fields and "Copy support info": ID handles (run ID, plan ID, preview ID, room ID, entry ID), each saying where to find the value; a checksum; raw state names. Docker and BlueZ detail belongs in documentation, not in flows (CP-0555).

## Grammar and tone

- Sentence case everywhere. Capitals only for the first word, Home Assistant, Bluetooth, Matic app, Matic (Unofficial), Matic Map, and a control name as the Matic app shows it.
- Fragments (titles, labels, buttons, chips, names, one-line notices and toasts such as "Plan saved") have no end punctuation, except `?` on a dialog title. Sentences end with a period.
- Buttons are verb first. Approved primary labels: "Clean {count} rooms", "Run plan" (the plan Run view; the home card says "Run {plan}"), and "Start cleaning" when no count applies. Bare "Clean" and bare "Start" are not used: they read as a state and have no object. Drop the object only under a heading that names it (Back, Cancel, Save) and on a dialog's destructive button (below).
- Second person for what the user does; Home Assistant or the robot is the subject of what the system did. Present tense; past only for what already happened ("Stop was not sent"); future only for a consequence ("This deletes {plan_name}.").
- No exclamation marks, "please", "sorry", "oops", "successfully", "simply". Do not blame ("invalid", "you entered"): say what can't be used. Contractions are fine ("can't", "didn't").
- Numbers are digits ("3 rooms", "5 minutes"); the fixed phrases "one-time", "six-digit code" and "a few" stay as words. Percent is `{percent}%`. Distances, areas, dates and times follow Home Assistant's units and formatters via a placeholder.
- Durations: labels and chips use "about 20 min", sentences use "about 20 minutes". Estimates start with "about"; an unknown duration is omitted, never "0 min" or "--".
- No em or en dashes. Use a period, comma or colon; ranges read "1 to 100". The ellipsis is the single character "…", only on an in-progress state ("Loading…"), never three periods, never on a button, and never left up without a timeout and a recovery action.
- Navigation paths use " > " (CP-0573, CP-0585). No arrows or other symbols that carry meaning, except naming a Home Assistant control ("the ⋮ menu").

## Structure rules

- Title limits: Matic Map headings and dialog titles 4 words or fewer; Repair titles and config or options step titles 6 words or fewer (CP-0933: "Can't confirm this is your robot"); buttons and button entity names 3 words or fewer, verb first; other entity names 4 words or fewer. Body: 2 sentences or fewer, in the order state, consequence, next action. More becomes a numbered list (up to 3 items, one sentence each, CP-0585) or moves to documentation.
- Disabled reasons are one sentence, shown at every width, in one of two forms. "Waiting for {thing}." when only time fixes it ("Waiting for the map to be ready.", the CP-0254 rewrite). "Can't {action} until {fix}." when the user can act (CP-0240, shortened to the guide: "Can't run this plan until you reset the room schedule progress Home Assistant can't confirm."). Never "unavailable" alone.
- Dialogs are for data loss only: delete, discard, reset. Title is verb plus object ("Delete plan?"), body names the object with a placeholder and states the consequence, the destructive button is the bare verb ("Delete", "Discard", "Reset"; the title carries the object), the safe button is "Cancel" or what is kept ("Keep editing"). Stop and Resume never open a dialog.
- Notices carry a tone (info, success, warning, error), one sentence, and at most one action of 3 words or fewer besides dismiss (dismiss is not an action). Success says what changed ("Plan saved"). A notice appears where the user acted, not only in the screen-reader region.
- Status line: state, then one consequence ("Stopping · Waiting for the robot"). After Stop, never promise the current room will finish: that depends on the plan's saved stop policy. Where the plan is known, state it plainly; hedge ("If the plan is set to…") only in static descriptions such as CP-1004.

## Placeholders and plurals

- Placeholders are `{snake_case}` and hold data only (a name, a number, a formatted time), never a translatable word. Every placeholder in a string is supplied at every call site; a literal `{error}` must never be visible (six sites omit it today, CP-0794).
- No concatenation. One string per sentence, so translators control word order. Never join fragments in code.
- Counts use a placeholder: `{count} rooms`. The TypeScript fallback substitutes `{name}` only, so ICU plural syntax is not used in `common`: write a `_one` key ("{count} room") and an `_other` key ("{count} rooms") and pick in code. Repairs, flow steps and exceptions cannot switch keys: write count-neutral text ("Custom areas to review: {count}", CP-0936) or pass the finished phrase as the placeholder.
- RTL: render user-supplied names inside `<bdi>`; no "left", "right" or arrow wording; keep a number and its unit in one placeholder; a separator such as "·" lives inside one translated string, never between joined strings.

## "Verified" and uncertainty

The word in this heading stands for three different things: a map is ready, saved data can't be confirmed, the robot reported something. Name the one you mean (CP-0197, CP-0469).

- State labels say the state ("Map ready", "Locating"). "Confirm" appears only in a sentence that names who can't confirm what, followed by the action that resolves it, or Retry.
- Never guess a cause. When the code records an unknown cause, say nothing about cause (CP-0807). Hedge ("may") only for behavior that depends on a setting (CP-1004), never for things the code knows.
- Uncertainty disables the dependent action, and the disabled reason says why (see Structure rules).

## Errors and aborts

- Every error names a next step the user can do now: "Check the robot, then try again."; "Retry preview"; "Pair again". An abort screen ends with the action that restarts the flow, for example "Turn Pairing mode off and back on in the Matic app, then start setup again." (CP-0558; "off and back on" is the phrase the tests pin).
- Raw exception text never reaches the user. `{error}` holds only a message the integration wrote, always supplied, and sits on its own line `Details: {error}` after the body (not counted in the sentence limit); drop the line when no such message exists. No `str(exception)`, file paths, hosts or response bodies.
- Exceptions shown in Home Assistant use `translation_key` and `translation_placeholders`. A literal in `raise` is for logs; one fact has the same words in `strings.json`, `translations/en.json`, TypeScript and Python.
- A failed Stop says Stop was not sent and what to do next (CP-0816: "Check the robot and press Stop again if it is still cleaning.").
- The robot-mismatch Repair (CP-0933, CP-0934) states the mismatch, offers "Update robot address" (the integration's ⋮ menu, Reconfigure) only for a moved address, otherwise a fresh Bluetooth pairing, and lists what removing the robot erases (plans, room settings, schedule progress, custom areas, history, saved maps).

## Entities, services, blueprints, LLM

- Entities: names are noun phrases of 4 words or fewer for what they show ("Robot cleaning runs", `ha-entities.md`), without "Matic" (Home Assistant prefixes the device name). Existing tests pin names starting "Robot " for the diagnostic upload and SSH tunnel entities. Button names are verb plus object, 3 words or fewer, with no status text: the Stop button is "Stop cleaning" (CP-0670); what happens to the current room goes in the action description (CP-1004). Option labels are sentence case ("Saved order", CP-0946).
- Actions: verb-first names, one name per action across action, button and blueprint. Developer actions carry "Advanced:" (CP-1077, CP-1083, CP-1085, CP-1089); plan-editing actions stay ordinary. Descriptions are third person and start with what the user gets (first word "Reads" or "Starts"). A field description is never just the field name (CP-0950); raw keys appear only in backticks after the plain explanation, in object fields. ID fields say where the value comes from ("List cleaning plans") and are marked `advanced`.
- Config and options flows: field labels are nouns; each `data_description` says what the value does or where to find it; abort and error text follow Errors and aborts.
- Blueprints: names are "Matic: <verb phrase of 4 words or fewer>" ("Matic: Clean when everyone leaves"); the brand prefix is fine on a blueprint name, a dash is not. In descriptions "Matic" is never the noun for the robot ("the robot"). Descriptions state every condition that stops the action, and each must be true in the code (CP-1127). Notification text never names a tool identifier (CP-1115).
- Blueprint inputs: every input has a name (a noun phrase of 4 words or fewer, glossary terms: "Robot", not "Matic vacuum", CP-1100; "Delay before cleaning", not the verb form "Wait before cleaning", CP-1103) and a description with what it controls, its default and one example. Prefer selectors to free text, except the plan input: the plan select entity holds one robot-wide selection (`select.py:103-145`), so a pick list cannot express a different plan per automation, and CP-1102's picker is not adopted. The plan input is a typed name with a description, an example and a blank-valid default (blank means the default plan), unless `ha-entities.md` D4 decides otherwise. UX1 check: before shipping, confirm the blueprint passes the typed name, or nothing, to the action's `plan` field and that it resolves to the plan.
- LLM tools: the description's first sentence says what it returns and whether it is read-only; the system prompt starts by telling the model to use plain words (CP-1152). Tool and field names are identifiers in backticks, never in anything a person reads. Tool errors follow Errors and aborts so the model can relay them. Release notes lead with what changed for the household and any action needed.

## Checklist

A reviewer answers yes or no; any no blocks the string. [auto] items are covered by the tests below, [manual] items are review judgment.

1. [manual] Does it state the state in household words?
2. [manual] Does it state the consequence where time or data could be lost?
3. [manual] Does an error, abort or disabled reason name one next action, in the allowed disabled form?
4. [manual] Does it use only glossary terms (robot, map, room, plan, custom area, schedule)?
5. [auto] Is it free of every denylist word (Advanced-only terms only in Advanced fields)?
6. [manual] Sentence case, no end period on fragments, no exclamation mark, "please" or dash?
7. [manual] Title within its limit, body 2 sentences or fewer, button 3 words or fewer and verb first?
8. [manual] Placeholders only, all supplied, no concatenation, counts through paired keys?
9. [manual] Is any uncertainty honest: who can't confirm what, no guessed cause, policy-dependent behavior hedged?
10. [auto] Is the text identical in `strings.json`, `translations/en.json` and the TypeScript fallback?
11. [manual] Does it fit at 320 px and read correctly in RTL with a 40-character name?
12. [manual] Does it respect the four owner decisions (Stop, shared progress, "Advanced:", re-pair recovery)?

**Automated checks.** Planned, file not yet written (UX0): `tests/test_frontend_translations.py` requires every `translate()` key, `labelKey`, `reasonKey` and notice key in the TypeScript to exist in `strings.json` `common` with a fallback equal to the stored value, no orphan `v4_*` key, and no `text:` notice literal in `effects.ts`. It enforces parity, not wording. Today `test_plan_ui_uses_clear_scheduler_language` (`tests/test_release_metadata.py:273`) checks four terms by substring, and only in the `options` category of `strings.json` and `translations/en.json`. UX1 extends it to the denylist tables with the stem and suffix pattern above, over every `strings.json` category, `services.yaml`, `blueprints/**`, `llm.py` and the Python and TypeScript literals that reach users, with an allowlist for Advanced actions and ID fields. Wording pins in the options-flow editing test and `test_user_copy_matches_pairing_and_plan_behavior` move with the copy.
