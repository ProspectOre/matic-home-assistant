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
- **Correct schedule weekdays and rooms.** The schedule sensor uses the app's
  weekday order and reads the rooms selected in each schedule.

The missing second schedule and unknown on/off state reported in #384 remain
under investigation. [Schedule diagnostics](native-schedule-diagnostics.md)
can report the message structure without exposing schedule contents.

Update through HACS and restart Home Assistant. Existing entities, plans,
custom areas and settings are kept. Home Assistant 2026.10 or later is required.
