"""Posture goals and photo timing through the real client and the simulator."""

from __future__ import annotations

import datetime
import math
from io import BytesIO

import pytest
from PIL import Image

from custom_components.matic_robot.client import MaticHermesClient
from custom_components.matic_robot.client.commands import (
    UserCommand,
    encode_posture,
)
from custom_components.matic_robot.client.hermes_reads import decode_latest_pose
from custom_components.matic_robot.client.models import RobotPose
from custom_components.matic_robot.client.snaps import decode_instamatic_snap

from .hermes_sim import Phase, SimulatedRobot
from .sim_mission import SimFloor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def _pose(client: MaticHermesClient) -> RobotPose:
    (entry,) = await client.async_get_collection_entries("latest_pose")
    return decode_latest_pose(entry)


async def test_a_posture_goal_parks_there_facing_its_heading(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    floor_plan = await client.async_get_floor_plan()

    await client.async_go_to_posture(
        floor_plan, encode_posture(x=3.0, y=0.5, heading=math.pi / 2)
    )
    state = await client.async_get_state()
    pose = await _pose(client)

    assert robot.phase is Phase.PARKED
    assert state.current_area == "Study"
    assert (pose.x, pose.y) == pytest.approx((3.0, 0.5))
    assert pose.heading == pytest.approx(math.pi / 2, abs=1e-3)

    # A later goal turns in place: same point, new heading.
    await client.async_go_to_posture(
        floor_plan, encode_posture(x=3.0, y=0.5, heading=-math.pi)
    )
    assert abs((await _pose(client)).heading) == pytest.approx(math.pi, abs=1e-3)


async def test_an_unreachable_goal_leaves_the_robot_where_it_was(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    floor_plan = await client.async_get_floor_plan()
    robot.block_next_goal()

    await client.async_go_to_posture(
        floor_plan, encode_posture(x=3.0, y=0.5, heading=0.0)
    )

    assert robot.phase is Phase.DOCKED
    assert robot.position is None
    assert (await _pose(client)).heading is None


async def test_a_goal_off_every_room_reports_no_area_and_docking_clears_it(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    floor_plan = await client.async_get_floor_plan()

    await client.async_go_to_posture(
        floor_plan, encode_posture(x=9.0, y=9.0, heading=0.0)
    )
    assert (await client.async_get_state()).current_area is None

    await client.async_send_user_command(UserCommand.DOCK)
    robot.arrive_at_dock()
    pose = await _pose(client)
    assert robot.position is None
    assert pose.heading is None


async def test_a_held_photo_is_saved_only_when_released(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    captured_at = datetime.datetime(2026, 11, 19, 12, tzinfo=datetime.UTC)
    webp = BytesIO()
    Image.new("RGB", (8, 6), (40, 90, 160)).save(webp, format="WEBP")
    photo_id = robot.queue_photo(webp.getvalue(), captured_at=captured_at)
    robot.hold_photos()

    await client.async_send_user_command(UserCommand.EMOTE_SNAP)
    assert await client.async_get_collection_entries("instamatic_snaps") == ()

    robot.release_photos()
    (entry,) = await client.async_get_collection_entries("instamatic_snaps")
    photo = decode_instamatic_snap(entry)
    assert photo.photo_id == str(photo_id)
    assert photo.captured_at == captured_at
