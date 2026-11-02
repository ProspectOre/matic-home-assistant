"""Bounded Hermes property and collection transport."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import (
    AsyncGenerator,
)
from time import monotonic
from typing import cast

from .exceptions import (
    CannotConnectError,
)
from .hermes_connection import HermesConnection
from .models import (
    HermesCollectionEntry,
)
from .proto.hermes_grpc import HermesStub
from .proto.hermes_pb2 import (
    CollectionRequest,
    InitialRequest,
    SubscriptionServiceConfig,
)
from .telemetry import TELEMETRY_PROPERTIES
from .telemetry_fields import TELEMETRY_NESTED_MAX_BYTES
from .transport import (
    BoundedStream,
    async_cancel_stream,
    response_value_bytes,
)
from .wifi_status import WIFI_STATUS_MAX_BYTES

_LOGGER = logging.getLogger(__name__)
_RPC_TIMEOUT = 10.0
_COLLECTION_TIMEOUT = 30.0
_COLLECTION_MAX_BYTES = 64 * 1024 * 1024


class HermesCollections:
    """Own collections behavior for one robot session."""

    def __init__(self, connection: HermesConnection) -> None:
        self._connection = connection

    async def async_get_property(
        self, collection_name: str, *, max_bytes: int | None = None
    ) -> bytes:
        """Read one authenticated Hermes property snapshot."""
        if max_bytes is None and collection_name in TELEMETRY_PROPERTIES:
            max_bytes = (
                WIFI_STATUS_MAX_BYTES
                if collection_name == "wifi_status"
                else TELEMETRY_NESTED_MAX_BYTES
            )
        if self._connection._channel is None:
            await self._connection.async_connect()
        channel = self._connection._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        async with (
            self._connection._map_stream_errors(f"{collection_name} stream"),
            asyncio.timeout(_RPC_TIMEOUT),
        ):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._connection._metadata
            ) as stream:
                if max_bytes is not None:
                    # Bound the frame before reading its body, allowing a small
                    # protobuf envelope around the separately bounded value.
                    cast(BoundedStream, stream).message_byte_limit = max_bytes + 4096
                await stream.send_message(request, end=True)
                response = await stream.recv_message()

        if response is None or not response.HasField("value"):
            raise CannotConnectError(
                f"Hermes {collection_name} stream returned no value"
            )
        payload = response_value_bytes(response)
        if max_bytes is not None and len(payload) > max_bytes:
            raise CannotConnectError("Hermes property exceeds its value byte limit")
        if not payload:
            raise CannotConnectError(
                f"Hermes {collection_name} stream returned an empty value"
            )
        return payload

    async def async_get_collection_count(self, collection_name: str) -> int:
        """Count the current entries in a verified Hermes collection."""
        if self._connection._channel is None:
            await self._connection.async_connect()
        channel = self._connection._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        count = 0
        async with self._connection._map_stream_errors(f"{collection_name} collection"):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._connection._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                cancel_stream = False
                deadline = monotonic() + _COLLECTION_TIMEOUT
                while count < 4096:
                    if monotonic() >= deadline:
                        cancel_stream = True
                        break
                    try:
                        async with asyncio.timeout(3 if count == 0 else 0.15):
                            response = await stream.recv_message()
                    except TimeoutError:
                        cancel_stream = True
                        break
                    if response is None:
                        break
                    if response.HasField("value"):
                        count += 1
                if count >= 4096:
                    cancel_stream = True
                if cancel_stream:
                    await async_cancel_stream(stream)
        return count

    async def async_get_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.15,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot of one authenticated Hermes collection."""
        if not 1 <= limit <= 4096:
            raise ValueError("Hermes collection limit must be between 1 and 4096")
        if self._connection._channel is None:
            await self._connection.async_connect()
        channel = self._connection._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        entries: list[HermesCollectionEntry] = []
        collected_bytes = 0
        async with self._connection._map_stream_errors(f"{collection_name} collection"):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._connection._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                cancel_stream = False
                deadline = monotonic() + _COLLECTION_TIMEOUT
                while len(entries) < limit:
                    if monotonic() >= deadline:
                        cancel_stream = True
                        break
                    try:
                        timeout = first_timeout if not entries else idle_timeout
                        async with asyncio.timeout(timeout):
                            response = await stream.recv_message()
                    except TimeoutError:
                        cancel_stream = True
                        break
                    if response is None:
                        break
                    if not response.HasField("value"):
                        continue
                    payload = response_value_bytes(response)
                    entry_size = len(response.key_bytes) + len(payload)
                    if collected_bytes + entry_size > _COLLECTION_MAX_BYTES:
                        await async_cancel_stream(stream)
                        raise CannotConnectError(
                            f"Hermes {collection_name} collection exceeds "
                            "the byte limit"
                        )
                    collected_bytes += entry_size
                    sequence = (
                        response.sequence_id
                        if response.HasField("sequence_id")
                        else None
                    )
                    entries.append(
                        HermesCollectionEntry(
                            bytes(response.key_bytes),
                            payload,
                            int(sequence.start_ts_nanos)
                            if sequence is not None
                            else None,
                            int(sequence.sequence_no) if sequence is not None else None,
                        )
                    )
                if len(entries) >= limit:
                    cancel_stream = True
                if cancel_stream:
                    await async_cancel_stream(stream)
        return tuple(entries)

    async def async_subscribe_collection_entries(
        self, collection_name: str
    ) -> AsyncGenerator[HermesCollectionEntry]:
        """Yield the initial snapshot and later updates from a collection.

        Unlike bounded diagnostic reads, this keeps the robot's server stream
        open. Map collections publish new pages on that stream rather than
        returning their complete history to every fresh snapshot reader.
        """
        if self._connection._channel is None:
            await self._connection.async_connect()
        channel = self._connection._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        failed_channel = channel
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        try:
            async with self._connection._map_stream_errors(
                f"{collection_name} subscription"
            ):
                async with HermesStub(channel).FetchCollection.open(
                    metadata=self._connection._metadata
                ) as stream:
                    # FetchCollection is a tracked bidirectional subscription.  The
                    # server sends one update, then waits for its sequence id to be
                    # acknowledged before advancing to the next cached or live item.
                    cancel_stream = True
                    try:
                        await stream.send_message(request, end=False)
                        while (response := await stream.recv_message()) is not None:
                            entry = None
                            if response.HasField("value"):
                                sequence = (
                                    response.sequence_id
                                    if response.HasField("sequence_id")
                                    else None
                                )
                                entry = HermesCollectionEntry(
                                    bytes(response.key_bytes),
                                    response_value_bytes(response),
                                    int(sequence.start_ts_nanos)
                                    if sequence is not None
                                    else None,
                                    int(sequence.sequence_no)
                                    if sequence is not None
                                    else None,
                                )
                            if response.HasField("sequence_id"):
                                await stream.send_message(
                                    CollectionRequest(sequence_id=response.sequence_id),
                                    end=False,
                                )
                            if entry is not None:
                                yield entry
                    except asyncio.CancelledError:
                        # grpclib's context manager handles exceptional exits with
                        # an immediate local reset. Do not await its network reset
                        # while HA is already cancelling this subscription: a
                        # stalled transport would hold config-entry unload open.
                        cancel_stream = False
                        raise
                    finally:
                        # Long-lived bidirectional streams otherwise attempt a
                        # graceful close during config-entry teardown. A robot that
                        # is still holding the subscription open can leave Home
                        # Assistant waiting for that handshake until its task-leak
                        # timeout. Explicit cancellation is local, bounded cleanup.
                        if cancel_stream:
                            await async_cancel_stream(stream)
        except CannotConnectError:
            _LOGGER.debug(
                "Replacing failed Hermes %s subscription channel", collection_name
            )
            await self._connection._async_reconnect_after_read_failure(failed_channel)
            raise

    async def async_get_tracked_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.25,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot while acknowledging tracked updates."""
        if not 1 <= limit <= 4096:
            raise ValueError("Hermes collection limit must be between 1 and 4096")
        entries: list[HermesCollectionEntry] = []
        iterator = self.async_subscribe_collection_entries(collection_name)
        received = False
        collected_bytes = 0
        deadline = monotonic() + _COLLECTION_TIMEOUT
        try:
            while len(entries) < limit:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    break
                timeout = min(idle_timeout if received else first_timeout, remaining)
                try:
                    async with asyncio.timeout(timeout):
                        entry = await anext(iterator)
                except StopAsyncIteration, TimeoutError:
                    break
                received = True
                collected_bytes += len(entry.key) + len(entry.value)
                if collected_bytes > _COLLECTION_MAX_BYTES:
                    raise CannotConnectError(
                        f"Hermes {collection_name} collection exceeds the byte limit"
                    )
                entries.append(entry)
        finally:
            await iterator.aclose()
        return tuple(entries)
