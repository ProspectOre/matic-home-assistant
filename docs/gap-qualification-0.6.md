# 0.6 gap qualification

This is a working qualification matrix, not a release or owner-acceptance
receipt. The current implementation is under change; bind final tests and review
to the final commit. Source tests, protocol captures, the installed host,
physical devices and owner approval are independent evidence. Existing
[feature verification](verification-0.5-features.md) records historical 0.5
results; the [map qualification proposal](qualification-map-experience.md)
defines the broader acceptance matrix.

| Work | Source or current evidence | Remaining evidence or boundary |
| --- | --- | --- |
| Stable-line hotfixes ([PRO-82](https://linear.app/prospectore/issue/PRO-82), [PRO-148](https://linear.app/prospectore/issue/PRO-148), [PRO-151](https://linear.app/prospectore/issue/PRO-151)) | The 0.5.1 beta 2 source at `db039c932fce65bc53adebf7e2aa9954b70d392e` includes [#388](https://github.com/ProspectOre/matic-home-assistant/pull/388), [#390](https://github.com/ProspectOre/matic-home-assistant/pull/390) and [#391](https://github.com/ProspectOre/matic-home-assistant/pull/391). Its floor identity and activation-bounded shared cadence are adapted to the 0.6 owners, preserving contributor commits and managed plan history. See the [0.5.1 notes](release-notes-0.5.1.md) and [native results](native-cleaning-results.md). | Qualify the combined head with #378, #379 and #380; reporter recovery, installation and release remain separate. |
| Installed candidate and rollback ([PRO-74](https://linear.app/prospectore/issue/PRO-74), [PRO-75](https://linear.app/prospectore/issue/PRO-75)) | Simulator upgrade/rollback has four phases; [drill](upgrade-drill.md) has its exact source and limitations. | History v2 requires a matching pre-upgrade backup for 0.5 rollback; rerun the final-head drill and separately qualify installation, asset readback, restart and actual backup restore. Simulator stores do not prove owner-store recovery. |
| Host storage efficiency ([PRO-71](https://linear.app/prospectore/issue/PRO-71)) | [Binary-store design](design-binary-tile-store.md) records synthetic process measurements and a proposed host gate. | Representative actual-host idle, startup and save peaks, write volume and memory headroom; determine migration timing from those results. No binary migration or real-host memory qualification is implied. |
| Daily completion limits ([PRO-128](https://linear.app/prospectore/issue/PRO-128)) | Source and focused tests must be bound to the final commit. | Verify restart, local-day transitions and physical outcomes separately; an unverified result must not become a completed clean. |
| Live stream and browser push ([PRO-130](https://linear.app/prospectore/issue/PRO-130), [PRO-131](https://linear.app/prospectore/issue/PRO-131)) | Both block beta 1. Short loopback test sent 300 updates across three simulators in 5.214s (57.53 aggregate/s); two clients coalesced events and passed final-state/readback checks without error or resync. A separate quiet phase checked one-robot notification isolation. Synthetic only; 70% request reduction is unproven. | The [combined stream gate](qualification-map-experience.md#existing-program-and-dependency-order) covers fresh reconnect, ordering, overflow/retry, polling continuity, authorization retirement, Stop, sustained load, actual host/network and devices. Default behavior is authorized; validation is not waived. |
| Map launch, selection, history and compare ([PRO-138](https://linear.app/prospectore/issue/PRO-138)) | Browser fixture covers 250 synthetic rooms and three workspace identities. HA E2E uses three TLS/gRPC simulators, two synthetic floors each, one 17-room plan, concurrent photos, floor switch and reload; 30 tests passed. Companion test checks WebSocket replay and per-entry drain. | Real 17+ room, multi-floor home with three distinct robots; named physical devices, actual host, camera framing, GPU/resources and physical floor/robot association remain open. |
| Map journey budgets ([PRO-139](https://linear.app/prospectore/issue/PRO-139)) | Freeze 15 paired 1.5M desktop runs admitted all 20 replacements with the same fixture; preliminary only. A Python harness also staged three synthetic stores across two floors (1.28 GB process high-water, including HA test harness and allocator effects). See [lab receipts](performance-map-lab-history.md#later-working-source-receipts). | Final-source 17+ room, multi-floor, three-distinct-robot end-to-end load. Record actual-host CPU/memory, concurrent network/reconnect behavior and named-device timing. Synthetic desktop/test-process numbers do not qualify physical devices or the host. |
| Responsive and accessibility ([PRO-144](https://linear.app/prospectore/issue/PRO-144)) | Browser and semantic tests provide partial automated evidence. | Test 320–1440 layouts, orientation, 200/400% zoom, RTL, long text, reduced motion, forced colors and 44 CSS-pixel product targets; native VoiceOver, TalkBack and Windows screen readers remain separate. |
| Rendering and lifecycle ([PRO-145](https://linear.app/prospectore/issue/PRO-145)) | The unchanged startup gzip ceiling is 98,304 bytes. A 1.5-million-cell close-zoom fixture completed 20 remounts and returned tracked graphics handles; timing was contended. A historical Freeze 14 fixture completed a 30-minute idle soak with partial instrumentation. See the [lab receipts](performance-map-lab.md). | Final-source transport-enabled build, 20-cycle/30-minute retention and resource-return evidence; structural 2D must avoid optional photo allocation where supported. GPU driver/resource and physical-device checks remain open; host storage is PRO-71. |
| Saved maps ([PRO-146](https://linear.app/prospectore/issue/PRO-146)) | The [storage contract](design-map-storage.md) specifies quota, keep/delete, undo and invalidation; implementation is in progress. | Durable failure, race, restore and disk-reclamation proof for whichever implementation lands. Active robot-map reset stays in the official app. |
| Run/stop attribution ([PRO-107](https://linear.app/prospectore/issue/PRO-107)) | Known finish/stop summary tags project to history; completion accounting and unknown tags remain separate. Focused parity tests passed on the working source. | Real start/stop actor and pause-cause captures remain open; neutral attribution is required until supported. |
| Maintenance and status parity ([PRO-109](https://linear.app/prospectore/issue/PRO-109)) | Supported known fields are handled without inventing unknown values. | Human Done, part-enum mapping, mop wear, new mop-roll override payload, 16-byte preview state and hardware-name mapping need verified evidence. |
| Path and docking parity ([PRO-110](https://linear.app/prospectore/issue/PRO-110)) | Unknown values and unsupported distinctions remain explicit. | Empty planned path, sink summons, vents, phase distinctions and device alignment need captures and physical verification. |
| Camera safety and analysis ([PRO-117](https://linear.app/prospectore/issue/PRO-117), [PRO-122](https://linear.app/prospectore/issue/PRO-122), [PRO-115](https://linear.app/prospectore/issue/PRO-115), [PRO-116](https://linear.app/prospectore/issue/PRO-116), [PRO-125](https://linear.app/prospectore/issue/PRO-125)) | [Camera workflows](camera-workflows.md) describes supported room-scoped behavior and remaining research. | Privacy, access, retention and robot-side deletion/readback need independent verification before unattended or aimed capture; do not infer support for unknown commands. |
| Contributor bootstrap ([PRO-133](https://linear.app/prospectore/issue/PRO-133)) | [Contributing](../CONTRIBUTING.md) names Node, browser engines and checks; targeted import-boundary tests pass in the existing environment. | A fresh temporary checkout installed the locked npm packages online; all three engines launched using an existing browser cache. A cold browser download and clean OS dependencies remain unverified. |

## Owner-host read and next steps

A read-only observation on October 31, 2026 found Home Assistant Core 2026.10.4,
the loaded Matic manifest at 0.5.0, and the robot docked with its coordinator
available and no active managed or native run. The backup catalog had five
entries, each reporting protection on its listed agents. A read-only check against
the historical installed commit did not match its content-addressed frontend URL;
the exact currently loaded tree therefore remains unverified. Backup metadata is
not a restore test, and live state may change. No candidate was installed and no robot command was
sent. Keep backup identifiers and host-specific details in private receipts.

The configured AspenOS read tools provide system version and live Matic state;
the authenticated HA WebSocket exposes `manifest/get` and `backup/info` for
loaded-version and backup metadata. Neither is evidence that a backup restores.
The bounded admin catalog does not itself expose backup metadata or Core process
memory; the configured MCP credential received HTTP 401 from the Core-stats
proxy. The existing Advanced SSH & Web Terminal app supplied read-only
`ha core stats` samples with protection mode still on. A short current-container
series and aggregate Matic-store file sizes are kept in the private host receipt.
They are not process RSS, an isolated map baseline, or load/save peaks. Docker process
inspection was unavailable under existing protection; no security settings changed.

For a candidate that the owner has already installed and authorized for checking,
use the [installed-check procedure](installed-check.md), with a private token file
and receipt directory:

```sh
.venv/bin/python scripts/installed_check.py --commit FULL_REVIEWED_COMMIT_ID \
  --skip-install --url "$HA_URL" --token-file "$HA_TOKEN_FILE" \
  --receipts "$PRIVATE_RECEIPTS" --ssh VERIFIED_HOST_ALIAS
```

The `--ssh` step requires a working, authorized host alias; omit it if unavailable
and report installed-file hashing as missing. Without `--physical`, the check sends
no cleaning or navigation command. Do not use the installation or physical options
until separately authorized. The script does not restore a backup.

For PRO-71, record host model/RAM and take timestamped `ha core stats` samples
through the existing authorized web terminal; where supported, record `VmRSS` and `VmHWM`
from `/proc/<core-pid>/status` and `write_bytes` from `/proc/<core-pid>/io`.
Identify the Core process and distinguish container totals from process RSS.
Capture idle, startup and save phases using the [measurement gate](design-binary-tile-store.md#measurement-gate-on-the-owners-ha-host),
with actual floor sizes and concurrent workload; do not treat a preexisting
lifetime high-water mark as a fresh restart peak. Restart, a cleaning run,
backup creation/restore and robot movement require their own authorization.
