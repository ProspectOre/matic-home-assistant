"""Verify plan accounting rolls back when Home Assistant storage cannot commit."""

from copy import deepcopy

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.json import JSONEncoder, prepare_save_json
from homeassistant.util.file import WriteError
from homeassistant.util.json import SerializationError

from custom_components.matic_robot.plans import (
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
    CleaningPlanManager,
    CleaningRoom,
    _CleaningPlanStore,
)


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Give the real storage API an isolated on-disk configuration directory."""
    return hass_tmp_config_dir


@pytest.fixture
def hass_storage() -> dict:
    """Opt out of the plugin's in-memory Store mock for these disk tests."""
    return {}


class _FailingEncoder(JSONEncoder):
    """Cause HA's JSON preparation stage to raise SerializationError."""

    def encode(self, obj: object) -> str:
        del obj
        raise TypeError("PRIVATE-JSON-CONTENT-DO-NOT-LEAK")


def _new_store(hass) -> _CleaningPlanStore:
    return _CleaningPlanStore(
        hass,
        STORAGE_VERSION,
        STORAGE_KEY,
        private=True,
        minor_version=STORAGE_MINOR_VERSION,
    )


async def _load_from_disk(hass) -> dict:
    """Read through a new Store so manager memory cannot mask disk state."""
    data = await _new_store(hass).async_load()
    assert data is not None
    return data


@pytest.mark.parametrize("failure", ["write", "serialization"])
async def test_failed_store_commit_rolls_back_room_credit_and_allows_retry(
    hass, failure: str
) -> None:
    """No room/cadence credit or listener success escapes a failed disk commit."""
    # The local hass_storage fixture opts out of the plugin's mock. Exercise the
    # real versioned JSON file and Store writer for these tests.

    manager = CleaningPlanManager(hass)
    store = _new_store(hass)
    manager._store = store
    await manager.async_load()

    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "synthetic-robot",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "name": room.name,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                }
            ],
        },
    )
    _effective_rooms, cadence = manager.resolve_cadence(
        "synthetic-robot", "home", [room]
    )
    await manager.async_begin_run(
        "synthetic-robot", "home", "run-one", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "synthetic-robot",
        "run-one",
        {
            "cadence_by_room": {room.room_id: cadence[room.room_id]},
            "completed_room_ids": [],
        },
    )
    assert await manager.async_mark_started(
        "synthetic-robot", "home", room, run_id="run-one"
    )

    durable_before = await _load_from_disk(hass)
    robot_before = deepcopy(manager._robot("synthetic-robot"))
    notifications: list[None] = []
    manager.async_add_listener("synthetic-robot", lambda: notifications.append(None))
    notifications.clear()

    if failure == "write":
        real_writer = store._write_prepared_data

        def fail_write(_mode: str, _json_data: str | bytes) -> None:
            raise WriteError("synthetic disk-full failure")

        store._write_prepared_data = fail_write
    else:
        real_encoder = store._encoder
        store._encoder = _FailingEncoder
        with pytest.raises(SerializationError):
            prepare_save_json({"safe": "fixture"}, encoder=_FailingEncoder)

    with pytest.raises(
        HomeAssistantError, match="Cleaning plan state could not be saved"
    ) as raised:
        await manager.async_mark_completed("synthetic-robot", "home", room)

    assert "PRIVATE-JSON-CONTENT-DO-NOT-LEAK" not in str(raised.value)
    assert "synthetic disk-full failure" not in str(raised.value)
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True
    assert manager._robot("synthetic-robot") == robot_before
    assert notifications == []

    durable_after_failure = await _load_from_disk(hass)
    assert durable_after_failure == durable_before

    if failure == "write":
        store._write_prepared_data = real_writer
    else:
        store._encoder = real_encoder

    await manager.async_mark_completed("synthetic-robot", "home", room)
    after_retry = manager._robot("synthetic-robot")
    assert after_retry["rooms"][room.room_id]["completed_runs"] == 1
    assert after_retry["plan_room_cadence"]["home"][room.room_id]["progress"] == {
        "mop": 1,
        "coverage": 0,
    }
    assert after_retry["last_run"]["recovery_checkpoint"]["completed_room_ids"] == [
        room.room_id
    ]
    assert len(notifications) == 1

    # Duplicate verified evidence retries persistence but never credits twice.
    await manager.async_mark_completed("synthetic-robot", "home", room)
    assert after_retry["rooms"][room.room_id]["completed_runs"] == 1
    assert after_retry["plan_room_cadence"]["home"][room.room_id]["progress"] == {
        "mop": 1,
        "coverage": 0,
    }

    durable_after_retry = await _load_from_disk(hass)
    durable_robot = durable_after_retry["robots"]["synthetic-robot"]
    assert durable_robot["rooms"][room.room_id]["completed_runs"] == 1
    assert durable_robot["plan_room_cadence"]["home"][room.room_id]["progress"] == {
        "mop": 1,
        "coverage": 0,
    }
