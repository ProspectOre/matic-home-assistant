# Single Map Studio editing workspace

Map Studio owns room, plan, and Area editing. Home Assistant **Configure** keeps
integration preferences and maintenance: default-plan selection, explicitly
confirmed one-plan/all-plan history reset, and reversible live updates.

The candidate removes the competing Configure editors, custom form selectors,
global loader, obsolete assets, and unused catalog `area_editor_url`. Existing
plan/Area actions, entities, saved data, geometry limits, and authenticated data
routes remain. `AreaGeometry` and `RoomGeometryIndex` now provide bounded backend
validation without Home Assistant selector registration or presentation imports.

## Ownership and recovery

A real-Store regression reproduced a reset queued behind plan deletion writing
history for the deleted plan. The manager now verifies the plan ID inside its
admitted metadata transaction before changing state. The regression fails before
the repair and passes afterward, including a fresh Store reload.

Configure uses the manager's check. A removed plan refreshes the chooser or
returns to settings when none remain. Unload rejects actions; accepted writes
retain manager ownership. Persistence failures remain visible. Reset confirmation
names the selected plan and explains the all-plans scope; unrelated preferences
and saved plan settings remain unchanged.

## Local qualification

On October 5, 2026, the frozen candidate passed:

- 3,896 Python tests; 16,514 statements at 100% coverage.
- Ruff lint and formatting, strict mypy, and the public-tree privacy check.
- Chromium and WebKit startup checks loading packaged Map Studio assets without
  the legacy editors, including the 90 KiB gzip startup budget.
- Independent scoped Options/ownership and geometry/frontend parity reviews,
  with no remaining concrete findings in those slices.

Obsolete editor tests were removed with their implementation. Geometry tests
moved to the shared backend module; modern V4 browser scenarios remain. Native
maintenance, admission races, failure propagation, inline guidance, and cadence
disable behavior retain explicit regression contracts. The acceptance matrix's
row identities remain unchanged.

This is local source evidence. Fresh exact-candidate hosted checks, full native
review and event acknowledgement, installed RC, device/accessibility, causal
coverage credit, transport/resource, owner, and physical acceptance remain
separate gates. The earlier desktop performance receipt applies only to its
recorded source; this cleanup makes no new latency, FPS, or memory claim.
