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
- **An explanation for missing room statistics.** When multiple saved floors
  prevent app-started room statistics from being matched safely, both room
  sensors explain why in `native_statistics_blocked_reason`. Verified managed
  results remain available. Native multi-floor statistics are still unsupported.
- **Correct native schedules.** The reader acknowledges schedule records so
  later entries can arrive. Weekdays use the app's order; enabled state and room
  ordering use their separate protocol fields. Room lists support ordered and
  unordered schedules, including larger whole-floor selections.

The protocol fixes have synthetic regression coverage. November 1 follow-ups
on `v0.5.1-beta1` add the following evidence:

- [#381](https://github.com/ProspectOre/matic-home-assistant/issues/381#issuecomment-6564163643):
  the reporter's replay confirms persistent errors no longer disappear when
  another code changes. Physical lid checks pass; the physical multi-code
  sequence was not repeated on the beta.
- [#382](https://github.com/ProspectOre/matic-home-assistant/issues/382#issuecomment-6564163822):
  the lid-open label and raw code 207 are confirmed on the robot. Code 220 has
  not recurred since installation and remains an observational label.
- [#383](https://github.com/ProspectOre/matic-home-assistant/issues/383#issuecomment-6564164035):
  single-floor app-started cleans update both room sensors, including a later
  clean without reload. With multiple floors, native statistics remain withheld
  because the integration cannot yet verify the history's floor identity.
  The sensor explanation above is a
  follow-up change and was not part of that beta test.
- [#384](https://github.com/ProspectOre/matic-home-assistant/issues/384#issuecomment-6564164213):
  both native schedules match their days, enabled state, ordering and room lists.

[Schedule diagnostics](native-schedule-diagnostics.md) can report record counts
and message structure without exposing schedule contents. These observations
cover the reporter's installation.

Thanks to [kpes](https://github.com/kpes) for the reports and the error confirmation,
weekday and room-decoding contributions in [#385](https://github.com/ProspectOre/matic-home-assistant/pull/385),
[#386](https://github.com/ProspectOre/matic-home-assistant/pull/386) and
[#387](https://github.com/ProspectOre/matic-home-assistant/pull/387). Their original
commits are retained alongside the additional hotfix changes.

Update through HACS and restart Home Assistant. Existing entities, plans,
custom areas and settings are kept. Home Assistant 2026.10 or later is required.
