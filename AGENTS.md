# AGENTS

## Review contract

Follow the [review and manual-merge checklist](docs/maintenance-reviews.md). Every candidate requires an authentic complete Codex review bound to its exact head and intended base, meaningful required CI, finding dispositions and a designated-owner manual merge. The request coordinator and bespoke custom status gate are retired by owner approval. Request regular `@codex review` directly on each opened or pushed PR head; check existing requests to avoid duplicates. Preserve historical review gaps and keep runtime, physical, release and human approval boundaries separate.

## Apple tool capabilities

- Inherit `/Users/alec/Dev/AGENTS.md`. Prefer discovered native `xcode-tools` for builds, tests, previews, and diagnostics; use XcodeBuildMCP or shell when unavailable or insufficient.
- Use official Apple documentation for API references when `DocumentationSearch` is absent. Rediscover tools each session; do not impose a fixed tool count or version requirement. Dated bridge evidence lives in `/Users/alec/Dev/wiki/workflows/xcode.md`.
