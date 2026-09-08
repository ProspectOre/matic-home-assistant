# 0.4 compatibility and validation

Home Assistant 2026.7 is the minimum supported version. Validation includes
Home Assistant Yellow, local Bluetooth pairing, and the integration's core
imports on Home Assistant Container.

Hardware checks on September 7–8 covered the following workflows. Earlier
failed mixed-settings and interruption checks were superseded by successful
retests; these results do not certify every later change on hardware.

- Same-entry reauthentication and recovery of saved configuration.
- Live maps and robot position, floor changes, and returning to a prior floor.
- One-time room cleaning, saved plans with different room settings, and custom areas.
- Immediate Stop and finish-current-room at 20%, 50%, and 60% against a 50%
  threshold, with no next-room start; paused time stayed excluded.
- Natural recharge/resume with the original native cleaning session; that
  mission ultimately ended partially complete.
- Native vacuum/mop history from a partial mission.
- Home Assistant restart recovery without replaying a cleaning command.
- iPhone navigation, saved outlines, and guided VoiceOver use.

Automated checks cover protocol decoding, command ownership, interruption,
privacy, packaging, and browser behavior in Chromium and WebKit. Hardware
results cover the tested setup, not every robot firmware or network condition.

## Known limits

- Firmware 172.15/protocol 25 localization behavior remains unverified on the
  affected hardware.
- Live network-loss recovery and Container reauthentication have not been
  physically verified for this release.
- Separate iPad and broader assistive-technology coverage remains incomplete.
- The final per-mode history fix was checked against the retained partial
  mission, without a new cleaning run. Protection against replacement by an
  unrelated OEM task has automated coverage but no controlled hardware retest.
- Older stable versions may not render maps produced by newer firmware.

See the [release notes](release-notes-0.4.md), [installation guide](../README.md#install),
and [native cleaning results](native-cleaning-results.md).
