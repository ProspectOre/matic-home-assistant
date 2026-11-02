# Matic 0.5.1

This hotfix addresses reports [#381](https://github.com/ProspectOre/matic-home-assistant/issues/381),
[#382](https://github.com/ProspectOre/matic-home-assistant/issues/382),
[#383](https://github.com/ProspectOre/matic-home-assistant/issues/383) and
[#384](https://github.com/ProspectOre/matic-home-assistant/issues/384).

- **Problems stay visible.** A confirmed error remains visible while another
  error appears or clears. A new error still needs two consecutive polls.
- **Readable error names.** Codes 207 and 220 identify the lid-open and
  mopping-water conditions. The Matic 1.182.1 decoder confirms the mappings;
  raw codes remain available and unknown codes remain unknown. This does not
  establish that every firmware version uses the same meanings.
- **Room statistics from app-started cleans.** Last cleaned and Last clean
  duration can use completed per-room vacuum and mop results, including app
  schedules. When the robot provides enough floor and room information, the
  sensors can match work across saved floors. Unclear matches are withheld, with a
  `native_statistics_blocked_reason` where applicable. See [cleaning results](native-cleaning-results.md).
- **App-started cleanings and room schedules.** The integration option is on by
  default and lets confirmed app-started and scheduled cleans advance shared
  room schedules from activation onward. Existing history is not backfilled.
  Home Assistant plan run counts, plan-only schedules and saved plan history remain separate. See
  [room schedules](room-schedules.md).
- **Schedules from the Matic app.** The reader acknowledges schedule records so
  later entries can arrive. Weekdays, enabled state and room ordering are read
  separately; ordered and unordered room lists are supported.

## Qualification

On beta1 the reporter confirmed lid-open handling and both app schedules.
On [beta2](https://github.com/ProspectOre/matic-home-assistant/issues/383#issuecomment-6583624314),
their app-started vacuum updated both room sensors without a reload; its
333-second room duration matched the robot's per-mode result. Their beta2 test
used one saved floor.

The maintainer tested beta2 with two saved floors. An app-started vacuum updated
the room sensors with 479 seconds of work and advanced a temporary shared
schedule once. Toggling app-started cleanings and reloading preserved that one credit;
Home Assistant plan counts and plan-only schedules did not change. The temporary schedule
was removed. History updates are asynchronous and can take several minutes.
See [cleaning results](native-cleaning-results.md) for the matching rules and
[Matic app decoder research](native-history-floor-evidence.md) for the protocol evidence.

Thanks to [kpes](https://github.com/kpes) for the reports and contributions in
[#385](https://github.com/ProspectOre/matic-home-assistant/pull/385),
[#386](https://github.com/ProspectOre/matic-home-assistant/pull/386) and
[#387](https://github.com/ProspectOre/matic-home-assistant/pull/387).

Back up Home Assistant, update through HACS and restart. Existing entities,
plans, custom areas and settings are kept. Home Assistant 2026.10 or later is
required.
