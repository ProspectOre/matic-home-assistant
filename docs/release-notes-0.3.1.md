# Release notes — 0.3.1

Released: 2026-07-29

## Summary

0.3.1 adds Matic's complete vacuum coverage choices to Home Assistant. Saved
plans, custom cleaning areas, the default coverage entity, and cleaning actions
now offer **Quick**, **Optimal**, and **Heavy Duty** using the same names as the
official app.

## Coverage compatibility

- Existing `standard` values remain valid and now display as **Optimal**. Saved
  plans, custom areas, automations, duration history, and entity state migrate
  without changes.
- New Heavy Duty selections use `heavy_duty` in action data and stored plan or
  area settings.
- Room cleaning and photo-map custom areas share the same verified encoding, so
  coverage behavior remains consistent across both workflows.

## Protocol and live verification

Matic's native app encoder identified Heavy Duty as the legacy
`DeprecatedDeep` protocol setting with wire value `0`. The implementation is
guarded by a byte-for-byte synthetic fixture containing no robot or household
data.

A bounded Heavy Duty vacuum run was exercised on a real robot. It left the
dock, navigated into the selected Hallway, accepted stop and dock commands, and
returned to the charger without a robot error.

The release passes 868 Python tests / 8,018 statements at 100% coverage, 38
browser tests, strict typing, lint and format checks, the public-tree privacy
gate, artifact parity, and clean-wheel import.

## Upgrading from 0.3.0

Install 0.3.1 through HACS and restart Home Assistant. Existing entries, plans,
custom areas, automations, and cleaning history are preserved. Re-pairing is
not required.
