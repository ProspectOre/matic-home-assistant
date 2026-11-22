"""The simulated robot's Bluetooth pairing mode.

The simulator serves Hermes over TLS, not Bluetooth. This model stands in for
``async_request_bluetooth_credential`` alone: it asks for the code the robot
shows through the flow's real passkey exchange and, for the right code, issues
a credential the simulated robot then accepts over Hermes. Scanning, the BlueZ
agent, bonds and the GATT exchange are not simulated.
"""

from __future__ import annotations

import asyncio
from typing import Any

from custom_components.matic_robot.bluetooth_pairing import (
    BluetoothCredentialGrant,
    BluetoothPairingIncompleteError,
    BluetoothPasskeyCancelledError,
    BluetoothPasskeyExchange,
)

from .hermes_sim import SimulatedRobot

# A synthetic Bluetooth address from the locally administered range.
ADDRESS = ":".join(("02",) * 6)


class PairingWindow:
    """Matic's Pairing mode: the code on its screen and the bonds it took."""

    def __init__(self, robot: SimulatedRobot, code: str) -> None:
        self.robot = robot
        self.code = code
        self.attempts = 0
        self.asked = asyncio.Event()
        self.released = False
        self._exchange: BluetoothPasskeyExchange | None = None

    def expire(self) -> None:
        """Time the shown code out, as BlueZ cancels the agent's request."""
        assert self._exchange is not None
        self._exchange.cancel()

    async def request_credential(
        self,
        hass: Any,
        user_id: str,
        exchange: BluetoothPasskeyExchange,
        stage_callback: Any = None,
        **_bond: Any,
    ) -> BluetoothCredentialGrant:
        """Bond for one attempt and issue a credential for the right code."""
        self.attempts += 1
        self._exchange = exchange
        exchange.begin_candidate()
        # BlueZ asks for the code from its own agent task, as here.
        request = asyncio.ensure_future(exchange.async_request_passkey())
        self.asked.set()
        try:
            await asyncio.wait({request})
            passkey = request.result()
        except BluetoothPasskeyCancelledError as err:
            raise BluetoothPairingIncompleteError("the code timed out") from err
        except asyncio.CancelledError:
            # The dialog was closed while the robot waited for its code; the
            # flow cancels the exchange, which ends the agent's request.
            self.released = True
            await asyncio.gather(request, return_exceptions=True)
            raise
        exchange.note_answered()
        if f"{passkey:06d}" != self.code:
            raise BluetoothPairingIncompleteError("the robot refused the code")
        return BluetoothCredentialGrant(
            self.robot.add_credential(user_id),
            address=ADDRESS,
            scoped_pairing=True,
            reused_existing_bond=False,
            passkey_requested=True,
            passkey_submitted=True,
            passkey_answered=True,
        )
