# 0.4.3.1 beta 1 — Bluetooth pairing recovery

🔑 **Recover a stale Bluetooth pairing during first-time setup.** If a robot
rejects the credential request after Home Assistant reuses an existing bond,
setup offers **Reset an existing Bluetooth pairing**. Select the affected robot
by its Bluetooth name and address to clear that bond and retry with a fresh code.

🛡️ **Recovery stays with the selected robot.** Only its bond is removed, once per
setup session. Retries do not switch to another nearby robot. If removal fails,
setup shows an error and stops further removal attempts.

This is a beta for testing issue #139. Real-device stale-bond recovery has not
yet been verified. Keep a backup and use HACS beta versions to install it, then
restart Home Assistant. See [local pairing](hermes-pairing.md) for setup and
recovery instructions. Restarting Home Assistant alone does not clear host
Bluetooth bonds.
