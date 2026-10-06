# Firmware intelligence

[Firmware compatibility](firmware-compatibility.md) · [Automation](automation.md)

Firmware intelligence keeps a durable, local evidence inbox in Home Assistant.
Any compatible investigator can claim a report and add cited research. Changing
the investigator preserves the observations and previous research.

## What gets checked

- Firmware, protocol and analyzer changes trigger an endpoint sweep. The first
  three scans are separated by at least 15 minutes; steady checks run every six
  hours. A naturally occurring activity not sampled before can trigger a scan
  after one hour. No cleaning is started to obtain evidence.
- The last good preceding baseline survives the rolling 52-snapshot limit and
  intervening failed releases. Field comparisons use the previous release's
  accumulated observations, so optional fields are less likely to look new.
- A new numeric protobuf field path means **newly observed, meaning unknown**.
  Seeing it again strengthens the observation; it does not verify a capability.
  Analyzer upgrades do not turn newly decoded structure into firmware features.
- A first read failure stays pending. Repeated failures create a Repair, and a
  successful read resolves that endpoint. Transport failure alone does not prove
  a firmware defect. Recovery is recorded and can notify after an earlier alert.

The **Firmware compatibility** sensor exposes the current bounded report:
versions, baseline availability, scan freshness, activity contexts, endpoint
failures, field paths, research, delivery status and investigator ownership.
Eight superseded reports and four prior investigation receipts are retained.
Raw robot payloads, maps, audio and credentials are excluded from the inbox.

## Notifications

Import [Firmware intelligence](../blueprints/automation/matic_robot/firmware_intelligence.yaml),
then select the robot, its Firmware compatibility sensor and your Companion app
notification action. Replace an older firmware alert automation to avoid two
independent notification senders. Use a unique notification identifier per HA server.

Discovery notifications are passive on iOS. Repeated read failures use normal
attention. Notifications include **View details**, **Check again**, and
**Acknowledge**. Recheck requests respect a 15-minute scan floor. Old notification
buttons cannot act on a newer report. Research is displayed as untrusted text.

Home Assistant saves pending delivery before emitting a report hint. The
blueprint reconciles after restart and every 30 minutes; it marks a revision
delivered only after both notification services accept it. Stable IDs replace
existing notifications on retry. Service acceptance is not proof a phone showed
the push; acknowledgement is tracked separately. Unchanged findings stay quiet.

## Choose or switch the investigator

In **Developer tools → Actions**, run **Matic Robot: Set firmware investigator**:

```yaml
action: matic_robot.firmware_investigator
target:
  entity_id: vacuum.matic
data:
  provider: openclaw
```

Use any lowercase name such as `openclaw`, `dot`, or `bot` (up to 48 characters,
letters, digits, underscores and hyphens). Set `manual` to stop automatic claims.
Routing changes require an authenticated administrator. The chosen agent must
already have a connection and a worker configured for that exact provider name;
this setting does not install or authenticate an agent.

Switching increments a routing revision and invalidates unfinished claims.
Completed research remains visible; future evidence goes to the new owner.
Agent names are routing labels, not authentication identities. The server
requires administrator authorization for every research tool call. Restrict a
worker's tools to these three APIs and public web research; a client tool filter
does not narrow the underlying HA administrator credential.

## Investigator contract

| Tool | Contract |
| --- | --- |
| `MaticGetFirmware` | Read cached reports, optionally retained history; no robot I/O |
| `MaticClaimFirmwareInvestigation` | Claim the configured provider's exact report, evidence revision and routing revision for 30 minutes |
| `MaticCompleteFirmwareInvestigation` | Submit that lease token, a bounded assessment and up to five public HTTPS sources |

1. Poll the cached inbox with deterministic code. Stay quiet if the configured
   provider differs, research is complete, or another live claim owns the report.
2. Use the returned `entry_id` as the robot selector, so duplicate display names
   cannot misroute research. Claim the exact current identifiers before model work. Keep the token
   private. A changed report, provider switch or expired lease rejects the result.
3. Compare retained observations with official firmware notes, vendor support
   documentation and relevant integration source. Separate published claims,
   directly observed facts and inference. Do not upload household data to search.
4. Return `known_behavior`, `needs_evidence`, `integration_opportunity`, or
   `compatibility_issue`, with a concise explanation and next useful verification.
   Use `needs_evidence` when no trustworthy source explains a field.
5. If completion is rejected, reread the inbox. Retry abandoned or expired work
   with bounded backoff. A failed research run must not suppress future retries.

OpenClaw can use a condition-triggered isolated cron job: a small trigger script
calls the cached read tool and starts an agent turn only for eligible work. Give
the agent a finite tool list containing the three firmware APIs plus web search
and fetch, and use no chat delivery because Home Assistant owns notifications.
Other agents can implement the same polling/claim/completion contract.

## Authority and limitations

Research never enables robot controls or proves physical compatibility. A new
command still needs a byte-for-byte synthetic fixture, evidence of safe real
robot acceptance, and normal implementation/release review. Findings can justify
an implementation proposal; installations, pairing and physical runs retain
their normal approval and acceptance requirements.

Events are hints, not the durable inbox. `matic_robot_firmware_report_updated`
contains the entry, report ID and notification revision; consumers should reread
the current report. History is bounded, claims expire, and unavailable agents
cannot prevent local checks or Home Assistant notifications.
