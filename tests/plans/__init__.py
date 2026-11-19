"""Tests of the plan manager and the managed runs it drives.

Each module covers one owner from docs/architecture.md: the manager's
lifecycle, catalog, cadence, rotation, duration learning, stop fences, run
outcomes, motion ownership, native reconciliation, and the executor's room,
leg, verification and handoff steps. Shared synthetic values live in
`fakes.py`; `conftest.py` holds the one fixture every module here needs.
"""
