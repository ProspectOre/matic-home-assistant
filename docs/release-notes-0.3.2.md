# Release notes — 0.3.2

Released: 2026-07-31

## Summary

0.3.2 makes Map Studio and custom cleaning areas substantially more natural on
phones and tablets. Controls respect device safe areas, the map remains the
primary surface, and editing details move into a compact contextual sheet.

## Touch navigation

- Pinch zoom, two-finger pan and twist rotation cooperate without abrupt mode
  changes or accidental drawing.
- Double-tap zoom and double-tap-drag zoom follow the target under the user's
  finger.
- A lifted finger transitions cleanly from a two-finger gesture into one-finger
  navigation.
- Momentum, elastic limits and spring-back keep exploration responsive while
  preventing the map from getting lost off-screen.
- Gesture cancellation, reduced-motion preferences and touch-target sizing are
  handled consistently across Map Studio and the custom-area editor.

## Mobile cleaning workspace

- Plans and custom areas remain first-class actions without obscuring the map.
- Custom-area drawing tools stay separate from navigation controls, reducing
  unintended brush marks during map exploration.
- Area name, cleaning settings and actions use a contextual bottom sheet that
  preserves useful map space and keeps feedback beside the action.
- Browser CI now exercises the touch-critical paths in mobile WebKit as well as
  the complete Chromium suite.

This release changes no robot protocol commands and sends no map data outside
Home Assistant.

## Verification

The release candidate passes 868 Python tests / 8,018 statements at 100%
coverage, 41 Chromium browser tests, three iPhone WebKit interaction tests,
strict typing, lint and format checks, the public-tree privacy gate, artifact
parity, and clean-wheel import.

## Upgrading from 0.3.1

Install 0.3.2 through HACS and restart Home Assistant. Existing entries, plans,
custom areas, automations, map history, and cleaning history are preserved.
Re-pairing is not required.
