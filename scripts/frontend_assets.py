"""Export the integration's actual frontend registration for offline browser QA."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from homeassistant.components import frontend as ha_frontend  # noqa: E402

from custom_components.matic_robot import frontend  # noqa: E402


async def main() -> None:
    """Capture routes and modules without running HA or opening a connection."""
    hass = MagicMock()
    hass.data = {
        ha_frontend.DATA_EXTRA_MODULE_URL: set(),
        frontend.__package__: {"workspace_socket": True},
    }
    hass.http.async_register_static_paths = AsyncMock()
    with patch(
        "homeassistant.components.panel_custom.async_register_panel",
        new_callable=AsyncMock,
    ) as register_panel:
        await frontend.async_register_room_plan_editor(hass)
    routes = hass.http.async_register_static_paths.call_args.args[0]
    print(
        json.dumps(
            {
                "extraModuleUrls": sorted(hass.data[ha_frontend.DATA_EXTRA_MODULE_URL]),
                "panel": register_panel.call_args.kwargs,
                "staticPaths": {
                    route.url_path: Path(route.path).relative_to(ROOT).as_posix()
                    for route in routes
                },
            }
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
