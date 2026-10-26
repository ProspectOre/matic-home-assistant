# Pairing import contract · 0.5

[Pairing guide](hermes-pairing.md#pair-on-another-device) · [Review requirements](maintenance-reviews.md)

This is the integration's compatibility contract for experimental pairing
import in 0.5. The community tool owns acquiring a robot-issued credential on
a Bluetooth-capable computer and testing that tool on its supported platforms.
This project owns the Home Assistant import, validation and storage path.
The external tool is not bundled with, or certified by, this integration.

## Credential interchange

- Produce the existing `HermesCredential.to_storage()` representation: standard
  Base64 of the serialized proto3 `hermes_auth.BotToken` message.
- `BotToken.user` (bytes, field 1) contains a serialized `TokenRequest`, whose
  `user_id` (string, field 1) is a UUIDv4. `BotToken.hashed_token` (bytes, field 2)
  contains the robot-issued token. Both byte fields must be nonempty.
- Use the robot's response; never manufacture a token from its shape. A valid
  encoding alone does not establish that the target robot accepts it.
- The canonical output is one Base64 string, without JSON, labels or a header.
  Home Assistant also accepts a case-insensitive `Bearer:` prefix, surrounding
  single/double quotes and outer whitespace, then stores the canonical value.
- There is no credential-format version or expiry field in this wire format.
  Config-entry migration versions are separate. Changing the interchange format
  requires an explicit compatibility/migration decision.
- Supply only the credential to the form. Host and port come from discovery or
  the address form. Do not import a helper's Bluetooth address, certificate pin,
  serial, hostname or config-entry JSON.

The source definitions are [auth.py](../custom_components/matic_robot/client/auth.py)
and [hermes_auth.proto](../custom_components/matic_robot/client/proto/hermes_auth.proto).

## Home Assistant behavior

Import is offered when the host has no local Bluetooth adapter, including a
proxy-only host. Adapter availability is checked again when choosing this path.
Hosts with an adapter continue through local Bluetooth pairing.

| Path | Required live checks before saving |
| --- | --- |
| Setup | Matic-CA certificate, expected hostname and discovered serial when available; authenticate on the pinned connection and verify returned robot identity. |
| Reauthentication / Pair Home Assistant again | Stored certificate pin, hostname and serial; authenticate the replacement credential before updating the entry. |
| Robot was reset | Matic-CA certificate with the stored hostname and serial; authenticate on that new pin; save credential and pin together and clear the Repair only on success. |

Malformed credentials are rejected locally. A foreign, revoked or otherwise
refused credential must fail live authentication. Parsing, certificate, identity,
connection and authentication failures must not replace the saved credential or
pin, create an entry, or clear an existing Repair. Cancelling has the same rule.

Errors about the pasted credential keep the masked paste field available.
Setup and reauthentication connection/certificate errors do too. Recovery
address or identity errors return to the recovery form so the address can be
corrected and import selected again. Retrying must not reuse an expired flow.
Successful import records `pairing_method: import`, not a Bluetooth address.

## Community tool requirements

- Require an intentional pairing action and unambiguous robot selection. Refuse
  an ambiguous target before contacting a robot; use the robot's normal passkey
  exchange rather than bypassing it.
- Save the credential to a user-selected local file with owner-only access
  (0600 on POSIX, an equivalent restricted ACL elsewhere). Refuse to overwrite
  an existing file unless the user explicitly chooses to replace it.
- Keep credentials out of normal console output, progress, errors and logs.
  Printing the single canonical value requires a separate explicit opt-in flag;
  do not print additional secret-bearing protobuf fields or headers.
- Do not upload credentials or ask users to paste them into issues, chat or test
  reports. Delete extra local copies after import. File deletion does not revoke
  access; revoke the paired user through the robot's supported controls.

The integration uses a password field, does not echo the credential in errors,
and redacts it from diagnostics. Diagnostics may report credential presence and
the pairing method. No real credential belongs in fixtures or public evidence.

## Test and release evidence

Integration tests cover parsing/normalization, adapter gating, all three flows,
mocked authentication and identity failures, no writes on failure, retry/session
handling and diagnostic redaction. These establish source behavior; they do not
verify the external tool or the robot's actual authentication decisions.

The tool maintainer supplies its revision, platform and redacted results for:

1. Successful setup on adapterless Home Assistant with a newly minted credential.
2. Reauthentication and reset recovery with a new credential; existing plans and
   areas are retained, and reset recovery only accepts the same robot identity.
3. A well-formed credential from another robot and a revoked credential refused
   by the target robot, with saved entry/pin/Repair state unchanged.
4. Offline/wrong-address retry, malformed input, cancellation and expired flows.
5. Default secret-free output, restricted file permissions, explicit-only secret
   printing and secret-free error/diagnostic reports.

Record Home Assistant version/install type, adapter/proxy setup, robot firmware,
tool revision/platform, flow and result. Never attach the pairing or raw config
entry. Report platform coverage honestly; one platform's pass does not cover all.

For 0.5, the integration import may ship as experimental after its complete
current-comparison review and required CI pass. External tool implementation and
hardware qualification remain contributor-owned, separately reported evidence;
their absence must not be described as end-to-end certification. An external
helper that fails the output requirements is not a verified compatible helper.
