"""The generated sprite's dimensions and transparency are shipping contracts."""

import json
from pathlib import Path

from PIL import Image

ASSETS = (
    Path(__file__).parents[1] / "custom_components/matic_robot" / "map_studio_v4/assets"
)


def test_robot_atlas_has_every_layer_without_clipping_or_a_shadow_plate() -> None:
    metadata = json.loads((ASSETS / "robot-atlas.json").read_text())
    assert metadata["frameSize"] == 128
    assert metadata["headings"] == metadata["columns"] == 32
    assert metadata["headingStep"] == 11.25
    assert metadata["pitches"] == [90, 55, 25]
    assert metadata["anchor"] == [0.5, 0.5]
    assert metadata["headingDirection"] == "clockwise-screen"
    path = ASSETS / "robot-atlas.webp"
    assert path.stat().st_size < 250_000
    with Image.open(path) as image:
        assert image.format == "WEBP"
        assert image.size == (4096, 1152)
        assert image.mode == "RGBA"
        for layer, offset in metadata["layers"].items():
            for pitch in range(3):
                for heading in range(32):
                    x, y = heading * 128, (offset + pitch) * 128
                    alpha = image.crop((x, y, x + 128, y + 128)).getchannel("A")
                    bounds = alpha.getbbox()
                    assert bounds is not None, (layer, pitch, heading)
                    if layer == "shadow":
                        for corner in (
                            (0, 0, 8, 8),
                            (120, 0, 128, 8),
                            (0, 120, 8, 128),
                            (120, 120, 128, 128),
                        ):
                            assert alpha.crop(corner).getextrema() == (0, 0)
                    else:
                        assert bounds[0] >= 3 and bounds[1] >= 3
                        assert bounds[2] <= 125 and bounds[3] <= 125
