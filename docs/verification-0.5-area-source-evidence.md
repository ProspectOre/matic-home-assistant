# 0.5 custom-area continuity source evidence

Source receipts for [custom-area continuity qualification](verification-0.5-area-continuity.md).
Installed and physical evidence remains separate in that qualification record.

The assembled PR #287 candidate passed **5,278 tests with 100.00% coverage**
across 20,147 statements (`python -m pytest --cov=custom_components/matic_robot
--cov-report=term-missing`). Exact-head PR CI and complete regular review must
pass before merging. Installed RC35, RC36 and RC37 retesting, including a supervised
RC37 custom-area run, is recorded in the qualification record's
[Installed and physical evidence](verification-0.5-area-continuity.md#installed-and-physical-evidence) section.

- Binding regressions cover partition churn, unrelated room changes,
  containing-room contour reshaping, fractional wall refinements, new overlaps,
  translations, room rekeys, missing historical evidence, and older versions.
- Persisted v3/v6 integration cases cover manager refresh, real HA Store reload,
  readiness, plan preview and service validation with unchanged areas and no
  area writes or robot commands. Unsafe cases remain blocked.
- Actual setup-listener cases cover repeated safe refreshes for v3 and v6,
  scheduled manager reconciliation, no new HA Repair, no Store save, and a
  valid saved-plan preview. These are controlled integration fixtures.
- Migration defensive guards are checked independently as well as through the
  stricter normal status path. No production guard was removed for coverage.
- Legacy v3 records may omit the optional global-frame digest. Their original
  local validation remains usable; strong recovery requires that digest and
  safely reports changed geometry when it is absent. Persistence, reload,
  readiness, preview and service-validation regressions cover this format.
- Multi-room v3 areas finish every legacy frame check before any optional
  witness query. A two-circle regression exercises both anchor orders and a
  retessellated 1,204-point room whose frame query exceeds 10,000 work units.
