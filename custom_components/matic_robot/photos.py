"""Serve saved robot photos to signed-in users."""

from __future__ import annotations

from http import HTTPStatus
from io import BytesIO

from aiohttp import web
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from PIL import Image, UnidentifiedImageError

from .const import DOMAIN
from .http import PRIVATE_NO_STORE_HEADERS, runtime_for_entry

PREVIEW_BLOCKS = 24


class MaticRobotPhotoView(HomeAssistantView):
    """Serve one recent robot photo to a signed-in user."""

    url = f"/api/{DOMAIN}/photo/{{entry_id}}/{{photo_id}}"
    name = f"api:{DOMAIN}:photo"

    async def get(
        self, request: web.Request, entry_id: str, photo_id: str
    ) -> web.Response:
        """Return the WebP, or 404 once it has left the library."""
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        image = (
            await runtime.photos.async_image(photo_id) if runtime is not None else None
        )
        if image is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        return web.Response(
            body=image,
            content_type="image/webp",
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticRobotPhotoPreviewView(HomeAssistantView):
    """Serve a deliberately pixelated photo for private notifications."""

    url = f"/api/{DOMAIN}/photo/{{entry_id}}/preview/{{photo_id}}"
    name = f"api:{DOMAIN}:photo-preview"

    async def get(
        self, request: web.Request, entry_id: str, photo_id: str
    ) -> web.Response:
        """Return the pixelated WebP; never fall back to the original image."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        source = (
            await runtime.photos.async_image(photo_id, preview=True)
            if runtime is not None
            else None
        )
        if source is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            image = await hass.async_add_executor_job(_pixelated_preview, source)
        except OSError, UnidentifiedImageError, ValueError:
            return web.Response(
                status=HTTPStatus.UNPROCESSABLE_ENTITY,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        return web.Response(
            body=image,
            content_type="image/webp",
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def _pixelated_preview(image_bytes: bytes) -> bytes:
    """Shrink to a small mosaic and enlarge with hard pixel edges."""
    with Image.open(BytesIO(image_bytes)) as source:
        source.load()
        width, height = source.size
        small = source.convert("RGB").resize(
            (max(1, width // PREVIEW_BLOCKS), max(1, height // PREVIEW_BLOCKS)),
            Image.Resampling.BOX,
        )
        mosaic = small.resize((width, height), Image.Resampling.NEAREST)
        output = BytesIO()
        mosaic.save(output, format="WEBP", quality=55, method=0)
        return output.getvalue()
