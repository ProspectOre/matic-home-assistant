# Matic 0.5.1

This hotfix addresses the four reports in
[#381](https://github.com/ProspectOre/matic-home-assistant/issues/381),
[#382](https://github.com/ProspectOre/matic-home-assistant/issues/382),
[#383](https://github.com/ProspectOre/matic-home-assistant/issues/383) and
[#384](https://github.com/ProspectOre/matic-home-assistant/issues/384).

- **Problems stay visible.** A confirmed error remains visible while another
  error appears or clears. Each new error still needs two consecutive polls.
- **Readable error names.** Codes 207 and 220 have labels for the observed
  lid-open and mopping-water conditions. The labels identify them as observations;
  raw codes remain available for automations and diagnosis.
- **Room statistics from app-started cleans.** Last cleaned and Last clean
  duration can use completed per-room vacuum and mop results reported by the
  robot, including scheduled cleans. They remain separate from plan completion
  counts and room schedules. See [room statistics](entities.md#room-statistics-and-the-recorder)
  for matching requirements.
- **Correct native schedules.** The reader acknowledges schedule records so
  later entries can arrive. Weekdays use the app's order; enabled state and room
  ordering use their separate protocol fields. Room lists support ordered and
  unordered schedules, including larger whole-floor selections.

The protocol fixes have synthetic regression coverage. Confirmation on the
reporter's installation remains open. [Schedule diagnostics](native-schedule-diagnostics.md)
can report record counts and message structure without exposing schedule contents.

Thanks to [kpes](https://github.com/kpes) for the reports and the error confirmation,
weekday and room-decoding contributions in [#385](https://github.com/ProspectOre/matic-home-assistant/pull/385),
[#386](https://github.com/ProspectOre/matic-home-assistant/pull/386) and
[#387](https://github.com/ProspectOre/matic-home-assistant/pull/387). Their original
commits are retained alongside the additional hotfix changes.

Update through HACS and restart Home Assistant. Existing entities, plans,
custom areas and settings are kept. Home Assistant 2026.10 or later is required.
