# AGENTS

## Review contract

Every candidate, including dependency changes, requires a clean exact-head Codex review through `/Users/alec/Dev/.worktrees/canonical-review-gate/scripts/review-gate/control.py`; use report or a dry-run request by default and apply only an eligible request. Keep runtime, physical, release, and human approval gates separate.

## Apple tool capabilities

- Inherit `/Users/alec/Dev/AGENTS.md`. Prefer discovered native `xcode-tools` for builds, tests, previews, and diagnostics; use XcodeBuildMCP or shell when unavailable or insufficient.
- Use official Apple documentation for API references when `DocumentationSearch` is absent. Rediscover tools each session; do not impose a fixed tool count or version requirement. Dated bridge evidence lives in `/Users/alec/Dev/wiki/workflows/xcode.md`.
