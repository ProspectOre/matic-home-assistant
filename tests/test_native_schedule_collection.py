"""Synthetic protocol coverage for native tracked schedule collections."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.endpoints import HERMES_ENDPOINT_MAP
from custom_components.matic_robot.client.proto.hermes_pb2 import SequenceId
from tests.wire_builders import _bfield, _vfield


def _schedule_payload(*, name: str, weekday: int, minute: int) -> bytes:
    weekly = _bfield(1, _vfield(weekday, 1)) + _bfield(3, _vfield(1, minute))
    return _bfield(1, weekly) + _bfield(2, name.encode())


def _response(key: bytes, value: bytes, sequence_id: SequenceId):
    wire_value = SimpleNamespace(
        value_bytes=value,
        value_bytes_deprecated=b"",
        fast_bytes=SimpleNamespace(bytes=b""),
        HasField=lambda field: False,
    )
    return SimpleNamespace(
        HasField=lambda field: field in {"value", "sequence_id"},
        value=wire_value,
        key_bytes=key,
        sequence_id=sequence_id,
    )


class _AckGatedScheduleStream:
    """Release the second schedule only after the first sequence is ACKed."""

    def __init__(self, records) -> None:
        self.records = records
        self.requests = []
        self._first_ack = asyncio.Event()
        self._index = 0
        self.cancelled = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def send_message(self, request, *, end):
        assert end is False
        self.requests.append(request)
        if (
            request.WhichOneof("request") == "sequence_id"
            and request.sequence_id == self.records[0].sequence_id
        ):
            self._first_ack.set()

    async def recv_message(self):
        if self._index == 0:
            self._index += 1
            return self.records[0]
        if self._index == 1:
            self._index += 1
            await asyncio.wait_for(self._first_ack.wait(), timeout=1)
            return self.records[1]
        return None

    async def cancel(self):
        self.cancelled = True


class _ScheduleStreamFactory:
    def __init__(self, records) -> None:
        self.records = records
        self.streams: list[_AckGatedScheduleStream] = []

    def open(self, *, metadata):
        stream = _AckGatedScheduleStream(self.records)
        self.streams.append(stream)
        return stream


async def test_schedule_inspection_and_telemetry_ack_and_read_both_records(
    monkeypatch,
) -> None:
    first_sequence = SequenceId(start_ts_nanos=10, sequence_no=1)
    second_sequence = SequenceId(start_ts_nanos=10, sequence_no=2)
    records = (
        _response(
            b"monday",
            _schedule_payload(name="Weekday", weekday=1, minute=420),
            first_sequence,
        ),
        _response(
            b"friday",
            _schedule_payload(name="Friday", weekday=5, minute=600),
            second_sequence,
        ),
    )
    streams = _ScheduleStreamFactory(records)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_collections.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=streams),
    )

    client = MaticHermesClient("robot.invalid", 16320)
    client._connection.async_channel = AsyncMock(return_value=object())
    client._reads._async_optional_property = AsyncMock(return_value=None)
    client._collections.async_get_collection_entries = AsyncMock(return_value=())
    client._collections.async_get_collection_count = AsyncMock(return_value=0)
    tracked_reader = client._collections.async_get_tracked_collection_entries

    async def tracked_dispatch(name: str, *, limit: int = 256):
        if name == "schedule_events":
            return await tracked_reader(name, limit=limit)
        return ()

    client._collections.async_get_tracked_collection_entries = tracked_dispatch

    assert HERMES_ENDPOINT_MAP["schedule_events"].tracked
    inspected = await client.async_inspect_endpoint("schedule_events", limit=2)
    telemetry = await client.async_get_telemetry()

    assert [entry.key for entry in inspected] == [b"monday", b"friday"]
    assert telemetry.scheduled_cleanings == 2
    assert [
        (item.name, item.weekdays, item.minute_of_day) for item in telemetry.schedules
    ] == [
        ("Weekday", ("monday",), 420),
        ("Friday", ("friday",), 600),
    ]
    assert len(streams.streams) == 2
    for stream in streams.streams:
        assert stream.requests[0].initial_request.collection_name == "schedule_events"
        assert [request.sequence_id for request in stream.requests[1:]] == [
            first_sequence,
            second_sequence,
        ]
        assert stream.cancelled
