# 0.4 release notes — draft

Unpublished draft, not a release announcement or acceptance certificate.
The installed test baseline is `56b4d4b`; additional audit changes remain
uninstalled. The intended first public candidate is `v0.4.0-rc1`, subject to
completed acceptance and explicit release approval. Intermediate builds are
not published releases.

## What's changing

- A map-first workspace brings one-time room cleaning, saved plans and custom
  areas together, with clearer loading, unavailable and recovery states.
- Original robot artwork is shared by the sidebar and cleaning controls.
- Room-based cleaning follows verified native room identities, so ordinary
  boundary refinement does not invalidate an unchanged room target.
- Coordinate-based areas retain their own geometry checks. Confirmable
  same-map changes stay in the area workspace rather than creating a global
  Repair; unsafe or different-floor geometry still requires recovery.
- Drafts, asynchronous results and preferences stay scoped to their owner.
  Navigation and failed saves preserve intent without applying stale results.
- Stop stays reachable while a start is awaiting acknowledgement. Status
  recovery does not automatically replay a possibly accepted cleaning command.
- Managed completion waits for positive native per-room evidence before
  crediting history. Native finished events use native history, and room starts
  are deduplicated.

## Validation and known limits

The installed baseline passed a bounded same-settings two-room run with one
credit/start/completion per room and one correct native finished event, followed
by clean return-to-charge and ownership cleanup. This is not evidence for all
physical workflows. Current audit fixes need final automated gates, exact-head
review, installation and affected live retests.

Different-settings mission legs, custom-area runs, Stop/interruption and
threshold behavior, a fresh floor round trip, affected #65/#71 hardware, native
VoiceOver and physical phone/tablet acceptance remain open. Fresh hardware
pairing and Container reauthentication also remain distinct checks. See the
[acceptance checklist](acceptance-0.4.md) for outcomes and release gates.

## Upgrade preparation

1. Wait for the approved candidate; do not interpret this draft as an available
   HACS release. Confirm that its release notes identify the accepted commit.
2. Back up Home Assistant and the integration's configuration before upgrading.
   Ensure the robot and relevant automations/scripts are idle before restart.
3. Install the approved version through HACS and restart Home Assistant.
4. Verify the installed version/artifact, available entities, coherent live map
   and pose, and clean native/managed state before authorizing a bounded run.
5. Preserve the previous backup until the new candidate's affected workflows
   have passed. Never run old and new integration copies simultaneously.

## Rollback

If verification fails, stop testing and keep the robot physically safe. Restore
the previously accepted integration and its matching Home Assistant backup,
then restart while idle and verify entity/map/runner state. Do not assume a
code-only downgrade can read storage written by a newer candidate. Follow the
specific published candidate's rollback guidance when it becomes available.
Do not post backups, maps, credentials or raw Home Assistant storage publicly.
