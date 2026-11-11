"""Robot responses frozen as bytes, with what was true of the robot then.

Each file in ``recordings/`` is one robot at one moment on one firmware
version: the entries of every Hermes endpoint it served, as hex key and value
pairs, the facts a correct decoder reads from them (``expect``) and the entity
states Home Assistant shows for them (``entities``). The bytes are data, not
the output of an encoder at test time, so a decoder that stops agreeing with
them fails.

``origin`` says where the bytes came from. ``synthetic`` bytes were assembled
once from the wire shapes the decoders and the simulator document. They hold
no robot's data and prove agreement with those shapes only. A ``recorded``
file is a read-only capture whose names, identifiers, networks and maps were
replaced before it entered the tree.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class Recording:
    name: str
    firmware: str
    endpoints: dict[str, list[tuple[bytes, bytes]]]
    expect: dict[str, Any]
    entities: dict[str, str]


def load_recordings() -> list[Recording]:
    """Read every recording, in file name order."""
    recordings = []
    for path in sorted((Path(__file__).parent / "recordings").glob("*.json")):
        data = json.loads(path.read_text())
        recordings.append(
            Recording(
                path.stem,
                data["firmware"],
                {
                    name: [
                        (bytes.fromhex(key), bytes.fromhex(value))
                        for key, value in entries
                    ]
                    for name, entries in data["endpoints"].items()
                },
                data["expect"],
                data["entities"],
            )
        )
    return recordings
