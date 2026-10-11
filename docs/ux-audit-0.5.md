# 0.5 UX audit (Phase A of the human-interface overhaul)

Status: audit complete; nothing in product code changed. Base commit `c00f878` (`origin/main`); harness commits on `ux/0.5-audit`.
Owner decision (2026-10-11): 0.5.0 stable is blocked until every human interface meets an Apple-level bar (intuitive, contextual, modern). Order: this audit → redesign spec and interactive mockups for sign-off → build PRs → new release candidate and qualification reset. Fixed choices: refine the existing `ms-*` design system with HA theme tokens (no `ha-*`/`mwc` rewrite, no iOS skin); room-schedule progress defaults to shared across plans; jargon entities are renamed and duplicates removed with stable unique_ids; identity-changed recovery requires a fresh Bluetooth re-pair and never relaxes certificate pinning; the Android p95 152 ms gesture latency (budget 100 ms) blocks stable and is investigated in this program.

Binding and unchanged: [`architecture-0.5.md`](architecture-0.5.md) shell invariants (one canvas, one status strip, one contextual primary action, fail-closed selectors, room/list parity, reversible Full map, read-only history) and the 2026-08-29 independent review (responsive table, accessibility rules, failure-state matrix).

## Findings by surface

| File | Scope | Findings | P0 | P1 | P2 | P3 |
|---|---|---:|---:|---:|---:|---:|
| [`ux-audit-0.5/map-studio-tasks.md`](ux-audit-0.5/map-studio-tasks.md) | Home, rooms, plan picker, plan editor | 41 | 0 | 16 | 21 | 4 |
| [`ux-audit-0.5/map-studio-shell.md`](ux-audit-0.5/map-studio-shell.md) | Status strip, host states, draw, area review, history, Full map, help, dialogs, diagnostics | 47 | 2 | 9 | 30 | 6 |
| [`ux-audit-0.5/responsive-a11y.md`](ux-audit-0.5/responsive-a11y.md) | Measured responsive contract, touch targets, axe, keyboard, forced colors, design-system tokens | 27 | 0 | 12 | 11 | 4 |
| [`ux-audit-0.5/ha-native.md`](ux-audit-0.5/ha-native.md) | Config/options flows, entities, actions, Repairs, blueprints, LLM tools | 52 | 2 | 12 | 32 | 6 |
| **Structural total** | | **167** | **4** | **49** | **94** | **20** |
| [`ux-audit-0.5/copy.md`](ux-audit-0.5/copy.md) + [`copy-corpus.tsv`](ux-audit-0.5/copy-corpus.tsv) | Every user-facing string (1,168 rows, scored separately) | 462 scored rows | 1 | 36 | 204 | 221 |

Structural findings and copy findings are scored once each: a wording problem lives in the copy corpus (`CP-NNNN`), the surface files cross-reference it. Where several files see one root cause, one row owns it and the others say "see X" with severity `—`, so they are not counted: forced-colors blank buttons → `MS-DS-01` (`MS-STATUS-08`, `MS-PLAN-11`); landscape-phone layout → `MS-RESP-01/02` (`MS-STATUS-03`, `MS-PLAN-10`); axe `aria-prohibited-attr` → `MS-AXE-01` (`MS-ROOMS-10`); dark-mode contrast in HA → `MS-AXE-03` (`MS-DS-03`); disabled icon buttons → `MS-STATUS-09` (`MS-PLAN-13`); notices invisible outside rooms/plan/area review → `MS-HOME-01`, with the rejected-Stop case kept as `MS-STATUS-02`.

## P0 findings (block a task, mislead about robot state or safety, or dead-end the user)

- `MS-STATUS-01` — after an accepted Stop the strip still reads "Cleaning" with a greyed Stop and no reason on wide layouts; `statusCopy` has no branch for the settling command.
- `MS-STATUS-02` — on home a rejected Stop re-enables Stop with no visible message; the notice renders screen-reader-only there (general case `MS-HOME-01`).
- `HA-ENT-01` — the update entity shows "Unknown" exactly when an update is available (`latest_version` returns `None` for `update_state == "available"`).
- `HA-REP-01` — the robot-identity-changed Repair sends the user to Reconfigure, which re-checks the old pinned certificate and fails; no path leads to re-pairing.
- Copy `CP-0934` — the identity-changed Repair text names TLS, pinning and a wrong integration name instead of stating the one recovery step (its title, `CP-0933`, is P1).

## Method

- **Evidence harness** (`tests/browser/map_studio_v4_ux_audit.spec.mjs`, `npm run audit:ux`): synthetic gallery fixtures only, no robot, no live Home Assistant. Matrix: 36 gallery scenarios plus 20 dialog/notice/help sets (56 sets, 860 captures) at 320/360/390/600/768/1024/1440 (phone 844 tall, 844×390 landscape, 768×1024, 1024×768, desktop 900) in light/LTR; dark, RTL and forced-colors + reduced-motion at 390 and 1024. Output under git-ignored `tests/browser/.generated/ux-audit/`: PNG, axe JSON, `manifest.json`, `summary.md`. No screenshot is committed; captures attach to the pull request.
- **Measurements** (`tests/browser/ux-audit-tools/`): `getBoundingClientRect` and computed-style scripts for the responsive table, touch targets, keyboard order, forced colors, reflow at 320×256, HA-theme contrast, token usage. Every number in `responsive-a11y.md` comes from one of these scripts.
- **Heuristics**: Apple Human Interface Guidelines (clarity, deference, depth, progressive disclosure, direct manipulation, consistency, feedback) plus the 2026-08-29 contract rows and the architecture invariants. Each finding cites exactly one principle and, where one applies, one contract clause.
- **Copy corpus**: every `strings.json` value, every `translate()` call and fallback, every notice literal in `effects.ts`, Python exceptions, LLM tool text and blueprint text, scored for jargon (denylist: mission, generation, coherence, fingerprint, SHA-256, Hermes, endpoint, ledger, runner lock, reconciliation, wire-shape, pinned, epoch, revision, OEM, native, payload, token, cadence, identity, authoritative, opportunity, session) and for state / consequence / next-action presence; every P0–P2 row carries a rewrite.
- **Accessibility**: axe serious/critical on every capture; scripted keyboard paths per workflow; 320 px stands in for 400 % zoom; forced colors and reduced motion emulated in Chromium.
- **Performance baseline**: not produced. `node scripts/measure_map_studio_performance.mjs c00f878` times out at this head waiting for the gallery's "3D" control (script line 145), before and after a documented rebuild; the shipped bundle is unchanged, so the cause is in the script or the review harness. The UX7 performance slice makes the script pass at `c00f878` before any "not worse than baseline" gate is applied.

## Severity and codes

- **P0** blocks a task, misleads about robot state or safety, or sends the user to a dead end. **P1** violates a binding contract line or causes major confusion (wrong mental model, contradictory controls, internal jargon on a primary path). **P2** is consistency or polish. **P3** is a nit.
- Principle codes: `HIG-Clarity`, `HIG-Deference`, `HIG-Depth`, `HIG-ProgressiveDisclosure`, `HIG-DirectManipulation`, `HIG-Consistency`, `HIG-Feedback`.
- Contract codes: `C-StateCopy` (state, consequence, next action; identities stay internal), `C-OneAction` (one primary action; disabled actions carry a reason), `C-OrderBadges` (numbers only in saved-order mode), `C-EngCopy` (engineering copy reaching the user is named debt), `C-Responsive` (320–1440 table), `C-A11y` (44 px targets, heading focus on enter, launcher focus on exit, list/map parity), `C-Feedback` (service rejection → inline error + toast), `C-History`, `C-FullMap`, `C-Dialogs`.
- Row format in every findings file: `ID | Sev | Surface · state · width | Evidence | Principle | Contract | Finding → Direction`.

## Inventory audited

- **Map Studio v4** (`frontend/map-studio-v4/`): home, rooms, plan picker, plan editor with per-room schedules, draw, area review, history, support; primary-action selector; status strip (18 states); six dialog kinds; two help surfaces; Full map; narrow sheet detents; overlays; diagnostics; design system (`tokens.ts`, `controls.ts`, `shell-styles.ts`).
- **Home Assistant-native**: config flow (zeroconf, user, manual, pair, reset bond, pairing code, reauth, reconfigure, address and local-access replacement), options flow, vacuum plus 13 binary sensors, about 25 sensors, 4 switches, 4 selects, 5 buttons, number, 2 cameras, update and event entities, 20 actions, 3 Repairs, 4 blueprints, 5 LLM tools, bus events.
- **Copy**: `strings.json` (849 leaves; `translations/en.json` identical), TypeScript fallbacks, `effects.ts` notices, Python exceptions, `services.yaml`, blueprints, `llm.py`.

## Evidence caveats

- Captures come from a desktop Chromium profile resized to each width: no touch emulation, no real device detents, no Windows High Contrast (forced colors are Chromium emulation). Measured sizes are exact for the layout; touch behaviour is inferred from geometry.
- The gallery runs on the design system's fallback palette (`#0678ce`); HA's default primary (`#009ac7`) fails contrast on white primary-button text (3.25:1). Axe totals in `summary.md` therefore understate contrast failures; `MS-AXE-03` carries the HA-palette run.
- RTL captures render English copy; only mirroring and directional icons were judged from them.
- Translation hypothesis (unverified live): the panel never calls `hass.loadBackendTranslation("common", "matic_robot")`, so every `component.matic_robot.common.*` key may be dead at runtime and users may see the TypeScript fallbacks. `copy.md` records 90 missing keys, 68 orphans and 28 hard-coded notices either way. Probe from the panel tab: `hass.localize("component.matic_robot.common.v4_ready")` before and after `await hass.loadBackendTranslation("common","matic_robot")`.

## Decisions for sign-off

- `MS-HELP-03` gesture model: one drag meaning across inputs, or per-input models plus help (no direction until decided).
- `MS-AXE-03` conditional fill darkening vs the frozen HA theme token mapping. Recommendation: keep HA's colour pair when it reaches 4.5:1, else darken the fill; never override HA's tokens unconditionally.
- `docs/acceptance-0.5.md:109` "Locating retains only exit control" → amend to "exit + Stop" (code: `shell.ts:1565-1569`) in the docs PR.
- `MS-RESP-04`: the 320 px inspector at 768 landscape (height ≥480) is a frozen contract row and binds; amend it only if the owner asks.
- 320 px header rule (`MS-HOME-09` robot picker vs `MS-RESP-07` title): both rows now recommend keeping the title and truncating the picker to its glyph + name; confirm one rule.

## Not done in this phase

- Live corroboration on the owner's Home Assistant (view-only walkthrough of every surface, Repairs, options, blueprints) — deferred; the browser extension was not connected. No live screenshot enters the repository when it runs.
- VoiceOver and NVDA scripts, iPad and Android device passes, the Android latency baseline — scheduled for the qualification reset after the build PRs.
- Effect-driven flows through `installPanelFixture` (save and delete feedback, HA Back, sheet detents) were not captured: `MS-STATUS-02` and `MS-PLANS-02` rest on code reading and are verified by the UX0/UX2 browser tests.

## Next

Phase B: `docs/ux-spec-0.5.md` with per-surface specs, interactive mockups served at `/map-studio-v4-mockups` from the real `ms-*` CSS, `docs/copy-style-0.5.md`, and the dated owner refinement of the "wholesale redesign" line in `architecture-0.5.md`. No build PR starts before the owner signs off at 390 and 1024, light and dark.
