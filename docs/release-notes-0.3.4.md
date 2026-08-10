# Release notes — 0.3.4

Released: 2026-08-09

## Summary

0.3.4 fixes a Bluetooth discovery false negative that could block initial
setup, reauthentication, or explicit credential replacement even when Home
Assistant's directly attached adapter had already found Matic. Routine robot
operation remains local-LAN only after authorization.

## Reliable local pairing discovery

- Home Assistant may retain a valid Matic scanner entry without replacing its
  advertisement object or advancing its timestamp during a requested active
  scan. Version 0.3.3 treated that unchanged cache entry as stale and discarded
  it, so setup incorrectly reported that Pairing mode was unavailable.
- The integration now requests the same active scan, reads Home Assistant's
  public discovery APIs, and follows each Matic address back to the individual
  scanner paths that observed it. An unchanged candidate from a directly
  attached, connectable adapter remains eligible for the BlueZ credential
  exchange.
- Scanner identity is checked per path. A remote proxy cannot lend Matic
  identity to a different local device, and proxy-only visibility is reported
  only when the current scan evidence came from that proxy.
- The scoped BlueZ agent, displayed-passkey flow, credential handling, TLS
  identity checks, and LAN-only runtime are unchanged.

The corrected path completed initial credential issuance on Home Assistant
2026.7.2 Container with a local BlueZ adapter on an ARM64 Linux host and Matic
firmware v171.10. Reauthorization, explicit credential replacement,
stale-bond recovery, and robot controls were not exercised in that validation,
so no broader live claim is made.

## Maintenance

The pinned GitHub Actions revisions for checkout, Python setup, Node setup, and
Hassfest are updated. NumPy remains at 2.3.2 to match Home Assistant's current
runtime and test-harness requirement.

## Verification

The release candidate passes 915 Python tests / 8,548 statements at 100%
coverage, 42 Chromium browser tests, three iPhone WebKit interaction tests,
strict typing, lint and format checks, the public-tree privacy gate, release
archive inspection, and a fresh-install import check.

## Upgrading from 0.3.3

Install 0.3.4 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, automations, map history, and cleaning history
are preserved. Existing working entries do not need to pair again.
