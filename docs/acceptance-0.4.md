# 0.4 compatibility and validation

Home Assistant 2026.7 is the minimum supported version. Validation includes
Home Assistant Yellow, local Bluetooth pairing, and the integration's core
imports on Home Assistant Container.

The following workflows have been exercised on real hardware:

- Same-entry reauthentication and recovery of saved configuration.
- Live maps and robot position, floor changes, and returning to a prior floor.
- One-time room cleaning, saved plans with different room settings, and custom areas.
- Immediate Stop, pause/resume, and finishing only the active room at a threshold.
- Natural recharge/resume with the original native cleaning session.
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
- Older stable versions may not render maps produced by newer firmware.

See the [release notes](release-notes-0.4.md), [installation guide](../README.md#install),
and [native cleaning results](native-cleaning-results.md).
