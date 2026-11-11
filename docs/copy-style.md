# Copy style

[Contributing](../CONTRIBUTING.md#documentation) · [Testing](testing.md) · [All guides](README.md)

Rules for every string a household member can read: Matic Map and its TypeScript fallbacks, config and options flows, entity and attribute names, actions, Repairs, blueprints, assistant tools, exceptions that reach the interface, the household guides and release notes. Log lines are exempt, but must not contradict the words used here.

These decisions are fixed and not open to rewording:

- Stop never asks for confirmation. Its consequence is stated in the status line once Stop is accepted.
- Room-schedule progress is shared across plans by default ("Across all plans"); the other choice is "In this plan only".
- Developer actions are named with an "Advanced:" prefix.
- A robot that no longer matches the one Home Assistant was set up with is recovered by a fresh Bluetooth pairing. Copy never offers to skip, accept or relax that check.

## The three-part rule

Copy that reports a problem or gates an action gives, in this order: **state** (what is true now, in household words), **consequence** (what it stops or erases, when not obvious), **next action** (one thing to do now). Labels need none. Errors need all three. Disabled reasons need the cause and the fix.

| Before | After | What changed |
|---|---|---|
| The robot's room map is unavailable. | Home Assistant doesn't have the robot's room map right now. Check that the robot is online and has a current map, then try again. | Adds who can't see it, and the next action |
| A valid next-run preview is required before starting. | Can't run this plan until you retry its next-run preview. | A disabled reason is one sentence with its fix |
| The saved-plan resolution changed before starting | The plan changed after you previewed it. Preview it again, then run the plan. | Cause in plain words, actions in order |
| Submitting clears rotation history for {plan_name}. Saved plans and their settings remain. | This clears which rooms {plan_name} has already cleaned, so the next run starts over. Your plans and their settings are kept. | Says what is lost and what is kept |

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
| Where progress counts ("Count cleans") | Across all plans (default), In this plan only | per-plan, global |
| How the robot cleans | cleaning mode | mode of operation |
| Vacuum rotation and vacuum coverage | "vacuum rotation" is a room's "{Level} vacuum every N cleans" schedule; "vacuum coverage" is a room's level setting (Quick, Optimal, Heavy duty). They share the level names and are never swapped | "coverage" for the schedule, "rotation" for the room's level |
| Charging base | dock | base, station |
| Bluetooth link to the robot | pairing; Pairing mode (a Matic app control, written as shown) | link, connect, authorization |
| The sidebar page | Matic Map | Map Studio, workspace, the panel |
| Software cannot tell | "Home Assistant can't confirm {thing}" or "can't match {thing}" | can't trust, invalid, illegal |
| Robot data checks | robot data check, item | ping, probe, poll |
| Developer actions | name starts "Advanced:" | unprefixed |

**Denylist.** Never shown to users. Matching is whole-word plus plural `s`/`es`, case-insensitive, and every word starting `verif`; other inflections ("rechecked") are not caught, so reviewers still read. `tests/test_docs.py` keeps this table and the test's list identical.

| Never write | Say instead |
|---|---|
| mission, leg, dock visit | run; part; "the robot may stop at the dock" |
| generation | drop it; "map update" or "latest map" |
| profile, section, round-robin | setting or cleaning mode; room; Intelligent rotation |
| session, managed, managed run | run; drop the word; plan |
| identity, authoritative | "can't match"; "can't confirm"; for `verif` words, "ready" or "confirmed" |
| cadence, interval, qualifying, schedule scope | room schedule; progress; counted; "Count cleans" |
| endpoint, payload, fingerprint, SHA-256, wire-shape, Hermes | robot data check; item; checksum (Advanced only) |
| token, revision, ledger, epoch, goal ID, stable ID | ID or version, with where to find it (Advanced only) |
| native, OEM | the robot's own stop; drop the word |
| coherence, reconciliation, runner lock, opportunity, handoff, recheck, scene | plain state ("busy", "waiting"); map; check again |
| credential, bond, local access | pairing; pair again |
| pinned, certificate, TLS | "can't confirm this is your robot" |
| workspace, Map Studio, routine, cleaning system | Matic Map; plan; cleaning mode |
| intent | command |

Allowed only in Advanced actions, their fields and "Copy support info": ID handles (run ID, plan ID, preview ID, room ID, entry ID), each saying where to find the value; a checksum; raw state names. Docker and BlueZ detail belongs in the guides, not in flows.

## Grammar and tone

- Sentence case everywhere. Capitals only for the first word, Home Assistant, Bluetooth, Matic app, Matic (Unofficial), Matic Map, and a control name as the Matic app shows it.
- Fragments (titles, labels, buttons, chips, names, one-line notices and toasts such as "Plan saved") have no end punctuation, except `?` on a dialog title. Sentences end with a period.
- Buttons are verb first. Approved primary labels: "Clean {count} rooms", "Run plan" (the home card says "Run {plan}"), and "Start cleaning" when no count applies. Bare "Clean" and bare "Start" are not used: they read as a state and have no object. Drop the object only under a heading that names it (Back, Cancel, Save) and on a dialog's destructive button.
- Second person for what the user does; Home Assistant or the robot is the subject of what the system did. Present tense; past only for what already happened ("Stop was not sent"); future only for a consequence ("This deletes {plan_name}.").
- No exclamation marks, "please", "sorry", "oops", "successfully", "simply". Do not blame ("invalid", "you entered"): say what can't be used. Contractions are fine.
- Numbers are digits ("3 rooms", "5 minutes"); the fixed phrases "one-time", "six-digit code" and "a few" stay as words. Percent is `{percent}%`. Distances, areas, dates and times follow Home Assistant's units and formatters through a placeholder.
- Durations: labels and chips use "about 20 min", sentences use "about 20 minutes". Estimates start with "about"; an unknown duration is omitted, never "0 min" or "--".
- No em or en dashes. Use a period, comma or colon; ranges read "1 to 100". The ellipsis is the single character "…", only on an in-progress state ("Loading…"), never on a button, and never left up without a timeout and a recovery action.
- Navigation paths use " > ". No arrows or other symbols that carry meaning, except naming a Home Assistant control ("the ⋮ menu").

## Structure

- Title limits: Matic Map headings and dialog titles 4 words or fewer; Repair titles and config or options step titles 6 words or fewer; buttons and button entity names 3 words or fewer, verb first; other entity names 4 words or fewer. Body: 2 sentences or fewer, in the order state, consequence, next action. More becomes a numbered list (up to 3 items, one sentence each) or moves to a guide.
- Disabled reasons are one sentence, shown at every width, in one of two forms: "Waiting for {thing}." when only time fixes it, and "Can't {action} until {fix}." when the user can act. Never "unavailable" alone.
- Dialogs are for data loss only: delete, discard, reset. The title is verb plus object ("Delete plan?"), the body names the object with a placeholder and states the consequence, the destructive button is the bare verb, and the safe button is "Cancel" or what is kept ("Keep editing"). Stop and Resume never open a dialog.
- Notices carry a tone (info, success, warning, error), one sentence, and at most one action of 3 words or fewer besides dismiss. Success says what changed ("Plan saved"). A notice appears where the user acted, not only in the screen-reader region.
- Status line: state, then one consequence ("Stopping · Waiting for the robot"). After Stop, never promise the current room will finish: that depends on the plan's saved stop setting.

## Placeholders and plurals

- Placeholders are `{snake_case}` and hold data only (a name, a number, a formatted time), never a translatable word. Every placeholder in a string is supplied at every call site; a literal `{error}` must never be visible.
- No concatenation. One string per sentence, so translators control word order.
- Counts use a placeholder: `{count} rooms`. The TypeScript fallback substitutes `{name}` only, so ICU plural syntax is not used in `common`: write a `_one` key and an `_other` key and pick in code. Repairs, flow steps and exceptions cannot switch keys: write count-neutral text ("Custom areas to review: {count}") or pass the finished phrase as the placeholder.
- Right-to-left: render user-supplied names inside `<bdi>`; no "left", "right" or arrow wording; keep a number and its unit in one placeholder; a separator such as "·" lives inside one translated string.

## Uncertainty

- State labels say the state ("Map ready", "Locating"). "Confirm" appears only in a sentence that names who can't confirm what, followed by the action that resolves it, or Retry.
- Never guess a cause. When the code records an unknown cause, say nothing about cause. Hedge ("may") only for behavior that depends on a setting, never for things the code knows.
- Uncertainty disables the dependent action, and the disabled reason says why.

## Errors and aborts

- Every error names a next step the user can do now: "Check the robot, then try again."; "Retry preview"; "Pair again". An abort screen ends with the action that restarts the flow, for example "Turn Pairing mode off and back on in the Matic app, then start setup again." ("off and back on" is the phrase the tests pin).
- Raw exception text never reaches the user. `{error}` holds only a message the integration wrote, always supplied, and sits on its own line `Details: {error}` after the body; drop the line when no such message exists. No `str(exception)`, file paths, hosts or response bodies.
- Exceptions shown in Home Assistant use `translation_key` and `translation_placeholders`. One fact has the same words in `strings.json`, `translations/en.json`, TypeScript and Python.
- A failed Stop says Stop was not sent and what to do next ("Check the robot and press Stop again if it is still cleaning.").
- The robot-mismatch Repair states the mismatch, offers "Update robot address" (the integration's ⋮ menu, Reconfigure) only for a moved address, otherwise a fresh Bluetooth pairing, and lists what removing the robot erases.

## Entities, actions, blueprints and assistant tools

- Entities: names are noun phrases of 4 words or fewer for what they show, without "Matic" (Home Assistant prefixes the device name). Button names are verb plus object, 3 words or fewer, with no status text: the Stop button is "Stop cleaning", and what happens to the current room goes in the action description. Option labels are sentence case ("Saved order").
- Actions: verb-first names, one name per action across action, button and blueprint. Descriptions are third person and start with what the user gets ("Reads", "Starts"). A field description is never just the field name; raw keys appear only in backticks after the plain explanation. ID fields say where the value comes from and are marked `advanced`.
- Config and options flows: field labels are nouns; each `data_description` says what the value does or where to find it.
- Blueprints: names are "Matic: <verb phrase of 4 words or fewer>" ("Matic: Clean when everyone leaves"). In descriptions "Matic" is never the noun for the robot. Descriptions state every condition that stops the action, and each must be true in the code. Notification text never names a tool identifier.
- Blueprint inputs: every input has a name (a noun phrase of 4 words or fewer, in glossary terms) and a description with what it controls, its default and one example. Prefer selectors to free text. The plan input is the exception: it is a typed name, blank for the default plan, because the plan select entity holds one robot-wide selection and can't express a different plan per automation.
- Assistant tools: the description's first sentence says what the tool returns and whether it is read-only. Tool and field names are identifiers in backticks, never in anything a person reads. Tool errors follow Errors and aborts so the model can relay them.
- Release notes lead with what changed for the household and any action needed.

## Checklist

Any "no" blocks the string. Items marked auto are covered by `test_plan_ui_uses_clear_scheduler_language` and `test_household_docs_use_the_copy_style` in `tests/test_release_metadata.py` and by `tests/test_frontend_translations.py`; the rest are review judgment.

1. Does it state the state in household words, and the consequence where time or data could be lost?
2. Does an error, abort or disabled reason name one next action, in the allowed form?
3. Does it use only glossary terms, and is it free of every denylist word (auto)?
4. Sentence case, no end period on fragments, no exclamation mark, "please" or dash?
5. Title within its limit, body 2 sentences or fewer, button 3 words or fewer and verb first?
6. Placeholders only, all supplied, no concatenation, counts through paired keys?
7. Is any uncertainty honest: who can't confirm what, and no guessed cause?
8. Is the text identical in `strings.json`, `translations/en.json` and the TypeScript fallback (auto)?
9. Does it fit at 320 px and read correctly right-to-left with a 40-character name?
10. Does it respect the four fixed decisions at the top?
