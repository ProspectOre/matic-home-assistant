"""The JSON metadata a scene and a live scene manifest carry.

`scripts/contract_types.py` generates Matic Map's types from it, as from
`map_schema`; for the same reason it does not postpone annotations.
"""

from typing import Literal, NotRequired, TypedDict

type SceneCoverageStatus = Literal["verified", "unavailable", "invalid", "too_large"]


class SceneRoom(TypedDict):
    """A room clipped to the mapped floor, in scene cells."""

    room_id: str
    name: str
    boundary: list[list[float]]
    boundary_closed: bool
    center: list[float]


class SceneCoverage(TypedDict):
    """The observed-cell mask; only a verified one carries the mask."""

    version: Literal[1]
    status: SceneCoverageStatus
    encoding: NotRequired[Literal["zlib-bitset-little-v1"]]
    origin_cells: NotRequired[list[int]]
    meters_per_cell: NotRequired[float]
    span_cells: NotRequired[list[int]]
    observed_cells: NotRequired[int]
    mask_sha256: NotRequired[str]
    mask_zlib_base64: NotRequired[str]
    diff_eligible: bool


class SceneMetadata(TypedDict):
    meters_per_cell: float
    origin_cells: list[int]
    span_cells: list[int]
    sample_step: int
    rooms: list[SceneRoom]
    coverage: NotRequired[SceneCoverage]
