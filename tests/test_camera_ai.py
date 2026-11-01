"""Photo attachment binding and AI Task disclosure behavior."""

from __future__ import annotations

import asyncio
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.components.ai_task.const import DATA_COMPONENT, AITaskEntityFeature
from homeassistant.components.media_player.browse_media import SearchMediaQuery
from homeassistant.components.media_source import MediaSourceItem, Unresolvable
from homeassistant.components.media_source.helper import async_resolve_media
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import llm
from homeassistant.setup import async_setup_component

from custom_components.matic_robot import camera_ai, llm_camera, photo_patrol
from custom_components.matic_robot import media_source as media_source_module
from custom_components.matic_robot.client.snaps import RobotPhoto
from custom_components.matic_robot.llm_camera import (
    MaticInvestigateTool,
    MaticTakePhotoTool,
)
from custom_components.matic_robot.media_source import (
    MaticPhotoMediaSource,
    async_get_media_source,
    photo_attachment_source,
)


def _llm_context() -> llm.LLMContext:
    return llm.LLMContext(
        platform="assist",
        context=Context(user_id="admin"),
        language="en",
        assistant="conversation",
        device_id=None,
    )


def _prepare_camera_tool(
    monkeypatch: pytest.MonkeyPatch, tool: MaticTakePhotoTool | MaticInvestigateTool
) -> tuple[SimpleNamespace, AsyncMock]:
    service_call = AsyncMock()
    hass = SimpleNamespace(services=SimpleNamespace(async_call=service_call))
    tool.resolve_entry = lambda *_args: SimpleNamespace(  # type: ignore[method-assign]
        entry_id="entry-one"
    )
    monkeypatch.setattr(
        llm_camera,
        "_PanelRobot",
        lambda *_args: SimpleNamespace(entity_id="vacuum.matic"),
    )
    return hass, service_call


def _photo(photo_id: str, image: bytes) -> RobotPhoto:
    return RobotPhoto(photo_id, datetime.now(UTC), image, None, 1, 1)


async def test_ai_attachment_is_immutable_even_if_newer_photo_arrives(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry = SimpleNamespace(entry_id="entry-one")
    source = photo_attachment_source(hass)
    submitted: dict[str, Any] = {}

    async def generate_data(_hass: HomeAssistant, **kwargs: Any) -> Any:
        submitted.update(kwargs)
        media_source_id = kwargs["attachments"][0]["media_content_id"]
        attachment = await source.async_resolve_media(
            MediaSourceItem.from_uri(hass, media_source_id, None)
        )
        submitted["image_bytes"] = attachment.path.read_bytes()
        # A newer capture arrives before the AI Task has resolved its input.
        await source.async_stage_photo("entry-one", "newer-photo", b"newer image")
        return SimpleNamespace(
            data={"problem": True, "summary": "A wet patch is visible."}
        )

    monkeypatch.setattr(camera_ai, "_async_generate_data", generate_data)
    result = await camera_ai.async_answer_about_photo(
        hass,
        entry,
        _photo("photo-one", b"original full image"),
        "Is water visible?",
        "ai_task.selected_entity",
        Context(),
    )

    assert submitted["image_bytes"] == b"original full image"
    assert submitted["entity_id"] == "ai_task.selected_entity"
    assert submitted["instructions"].endswith("Is water visible?")
    assert result["problem"] is True
    assert "may be cloud-based" in result["disclosure"]
    assert len(source._staged) == 1  # only the synthetic newer capture remains

    staged_id = submitted["attachments"][0]["media_content_id"]
    with pytest.raises(Unresolvable):
        await source.async_resolve_media(
            MediaSourceItem.from_uri(hass, staged_id, None)
        )


async def test_private_photo_source_releases_staged_bytes_after_use(
    hass: HomeAssistant,
) -> None:
    source = photo_attachment_source(hass)
    media_source_id = await source.async_stage_photo(
        "entry-one", "photo-one", b"private full image"
    )
    resolved = await source.async_resolve_media(
        MediaSourceItem.from_uri(hass, media_source_id, None)
    )
    path = Path(resolved.path)

    await source.async_release(media_source_id)

    assert not await asyncio.to_thread(path.exists)
    with pytest.raises(Unresolvable):
        await source.async_resolve_media(
            MediaSourceItem.from_uri(hass, media_source_id, None)
        )


async def test_concurrent_ai_calls_keep_their_own_photo_snapshots(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry = SimpleNamespace(entry_id="entry-one")
    source = photo_attachment_source(hass)
    both_ready = asyncio.Event()
    started = 0
    images: dict[str, bytes] = {}

    async def generate_data(_hass: HomeAssistant, **kwargs: Any) -> Any:
        nonlocal started
        question = kwargs["instructions"].rsplit("User question: ", maxsplit=1)[1]
        attachment_id = kwargs["attachments"][0]["media_content_id"]
        resolved = await source.async_resolve_media(
            MediaSourceItem.from_uri(hass, attachment_id, None)
        )
        started += 1
        if started == 2:
            both_ready.set()
        await both_ready.wait()
        images[question] = await asyncio.to_thread(Path(resolved.path).read_bytes)
        return SimpleNamespace(data={"problem": False, "summary": "No issue visible."})

    monkeypatch.setattr(camera_ai, "_async_generate_data", generate_data)
    results = await asyncio.gather(
        camera_ai.async_answer_about_photo(
            hass,
            entry,
            _photo("one", b"first immutable photo"),
            "Question one",
            "ai_task.one",
            Context(),
        ),
        camera_ai.async_answer_about_photo(
            hass,
            entry,
            _photo("two", b"second immutable photo"),
            "Question two",
            "ai_task.two",
            Context(),
        ),
    )

    assert images == {
        "Question one": b"first immutable photo",
        "Question two": b"second immutable photo",
    }
    assert len(results) == 2
    assert source._staged == {}


async def test_staged_photo_count_is_reserved_before_concurrent_writes(
    hass: HomeAssistant,
) -> None:
    source = photo_attachment_source(hass)
    results = await asyncio.gather(
        *(
            source.async_stage_photo("entry-one", f"photo-{index}", b"snapshot")
            for index in range(media_source_module.MAX_STAGED_ATTACHMENTS + 1)
        ),
        return_exceptions=True,
    )

    media_ids = [result for result in results if isinstance(result, str)]
    errors = [result for result in results if isinstance(result, ValueError)]
    assert len(media_ids) == media_source_module.MAX_STAGED_ATTACHMENTS
    assert len(errors) == 1
    assert len(source._staged) == media_source_module.MAX_STAGED_ATTACHMENTS
    await asyncio.gather(*(source.async_release(media_id) for media_id in media_ids))


async def test_staged_photo_expires_without_another_request(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(media_source_module, "ATTACHMENT_TTL_SECONDS", 0.01)
    source = photo_attachment_source(hass)
    media_source_id = await source.async_stage_photo("entry-one", "photo", b"image")
    token = media_source_id.rsplit("/", maxsplit=1)[-1]
    path = source._staged[token].path

    await asyncio.sleep(0.03)

    assert token not in source._staged
    assert not await asyncio.to_thread(path.exists)


async def test_hung_ai_call_cannot_retain_the_attachment_past_expiry(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Keep the real expiry callback registered, then fire that captured timer
    # only after the provider has resolved the attachment. A tiny wall-clock
    # TTL can expire during executor-backed staging on a busy full-suite run.
    monkeypatch.setattr(media_source_module, "ATTACHMENT_TTL_SECONDS", 60)
    source = photo_attachment_source(hass)
    provider_started = asyncio.Event()
    never_finish = asyncio.Event()
    attachment_path: Path | None = None
    media_source_id: str | None = None

    async def hang_after_resolving(_hass: HomeAssistant, **kwargs: Any) -> Any:
        nonlocal attachment_path, media_source_id
        media_source_id = kwargs["attachments"][0]["media_content_id"]
        resolved = await source.async_resolve_media(
            MediaSourceItem.from_uri(hass, media_source_id, None)
        )
        attachment_path = Path(resolved.path)
        provider_started.set()
        await never_finish.wait()

    monkeypatch.setattr(camera_ai, "_async_generate_data", hang_after_resolving)
    task = asyncio.create_task(
        camera_ai.async_answer_about_photo(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            _photo("photo", b"private image"),
            "What is shown?",
            "ai_task.selected",
            Context(),
        )
    )
    try:
        await asyncio.wait_for(provider_started.wait(), timeout=5)
        assert attachment_path is not None
        assert media_source_id is not None

        token = media_source_id.rsplit("/", maxsplit=1)[-1]
        timer = source._expiry_handles[token]
        timer_callback = timer._callback
        timer_args = timer._args
        timer.cancel()
        assert timer_callback is not None
        # Invoke the callback registered with call_later and observe the tasks
        # it schedules. Calling async_release here would mask a broken callback.
        cleanup_before = set(source._cleanup_tasks)
        timer_callback(*timer_args)
        expiry_tasks = source._cleanup_tasks - cleanup_before
        assert expiry_tasks
        await asyncio.wait_for(asyncio.gather(*expiry_tasks), timeout=5)

        assert not await asyncio.to_thread(attachment_path.exists)
        assert token not in source._staged
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_cancelled_executor_write_is_joined_before_cleanup(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = photo_attachment_source(hass)
    started = threading.Event()
    resume = threading.Event()
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=2)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    task = asyncio.create_task(source.async_stage_photo("entry-one", "photo", b"image"))
    assert await asyncio.to_thread(started.wait, 1)
    path = next(iter(source._staged.values())).path
    task.cancel()
    resume.set()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert source._staged == {}
    assert source._writes == {}
    assert not await asyncio.to_thread(path.exists)


async def test_cancelled_release_keeps_its_quota_reservation_until_write_finishes(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = MaticPhotoMediaSource()
    started = threading.Event()
    resume = threading.Event()
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=2)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    stage = asyncio.create_task(source.async_stage_photo("entry", "photo", b"image"))
    assert await asyncio.to_thread(started.wait, 1)
    token = next(iter(source._staged))
    path = source._staged[token].path
    media_id = f"media-source://matic_robot/{token}"
    release = asyncio.create_task(source.async_release(media_id))
    await asyncio.sleep(0)
    release.cancel()
    await asyncio.sleep(0)

    assert not release.done()
    assert token in source._staged
    assert len(source._staged) == 1
    assert await asyncio.to_thread(path.exists) is False

    resume.set()
    with pytest.raises(asyncio.CancelledError):
        await release
    await asyncio.gather(stage, return_exceptions=True)

    assert source._staged == {}
    assert source._writes == {}
    assert not await asyncio.to_thread(path.exists)
    await source.async_close()


async def test_unloading_entry_releases_only_its_attachments_and_reactivation(
    hass: HomeAssistant,
) -> None:
    source = photo_attachment_source(hass)
    released_id = await source.async_stage_photo(
        "entry-one", "photo-one", b"private one"
    )
    retained_id = await source.async_stage_photo(
        "entry-two", "photo-two", b"private two"
    )
    released_token = released_id.rsplit("/", maxsplit=1)[-1]
    retained_token = retained_id.rsplit("/", maxsplit=1)[-1]
    released_path = source._staged[released_token].path
    retained_path = source._staged[retained_token].path
    initial_generation = source.capture_entry_generation("entry-one")
    source.activate_entry("entry-one")
    assert source.capture_entry_generation("entry-one") == initial_generation

    await source.async_release_entry("entry-one")

    assert released_token not in source._staged
    assert not await asyncio.to_thread(released_path.exists)
    assert retained_token in source._staged
    assert await asyncio.to_thread(retained_path.exists)
    with pytest.raises(Unresolvable):
        await source.async_resolve_media(
            MediaSourceItem.from_uri(hass, released_id, None)
        )
    assert await source.async_resolve_media(
        MediaSourceItem.from_uri(hass, retained_id, None)
    )
    with pytest.raises(ValueError, match="attachments are unavailable"):
        await source.async_stage_photo("entry-one", "late-photo", b"late")

    source.activate_entry("entry-one")
    reloaded_id = await source.async_stage_photo(
        "entry-one", "reloaded-photo", b"reloaded"
    )
    reloaded_token = reloaded_id.rsplit("/", maxsplit=1)[-1]
    assert source._staged[reloaded_token].entry_id == "entry-one"
    await source.async_close()


async def test_stage_rejects_generation_changed_during_expiry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MaticPhotoMediaSource()
    expiry_started = asyncio.Event()
    allow_expiry = asyncio.Event()

    async def hold_expiry() -> None:
        expiry_started.set()
        await allow_expiry.wait()

    monkeypatch.setattr(source, "_async_expire", hold_expiry)
    staging = asyncio.create_task(
        source.async_stage_photo("entry-one", "photo", b"private")
    )
    await expiry_started.wait()

    await source.async_release_entry("entry-one")
    source.activate_entry("entry-one")
    allow_expiry.set()

    with pytest.raises(media_source_module.PhotoAttachmentUnavailable):
        await staging
    assert source._staged == {}
    await source.async_close()


async def test_ai_photo_refuses_unavailable_entry_before_provider_call(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = photo_attachment_source(hass)
    await source.async_release_entry("entry-one")
    provider = AsyncMock()
    monkeypatch.setattr(camera_ai, "_async_generate_data", provider)

    with pytest.raises(HomeAssistantError, match="photo analysis is unavailable"):
        await camera_ai.async_answer_about_photo(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            _photo("photo-one", b"private image"),
            "What is shown?",
            "ai_task.selected",
            Context(),
        )

    provider.assert_not_awaited()
    assert source._staged == {}
    await source.async_close()


async def test_entry_release_joins_held_write_and_prevents_late_publication(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = photo_attachment_source(hass)
    retained_id = await source.async_stage_photo(
        "entry-two", "photo-two", b"other entry"
    )
    started = threading.Event()
    resume = threading.Event()
    original_write = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=2)
        return original_write(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    staging = asyncio.create_task(
        source.async_stage_photo("entry-one", "held-photo", b"held image")
    )
    assert await asyncio.to_thread(started.wait, 1)
    token = next(
        token
        for token, staged in source._staged.items()
        if staged.entry_id == "entry-one"
    )
    path = source._staged[token].path
    releasing = asyncio.create_task(source.async_release_entry("entry-one"))
    await asyncio.sleep(0)
    assert not releasing.done()
    media_id = f"media-source://matic_robot/{token}"
    resolving = asyncio.create_task(
        source.async_resolve_media(MediaSourceItem.from_uri(hass, media_id, None))
    )
    await asyncio.sleep(0)
    assert not resolving.done()
    resume.set()

    with pytest.raises(
        ValueError,
        match=r"runtime changed|released during staging|expired before use",
    ):
        await staging
    with pytest.raises(Unresolvable):
        await resolving
    await releasing

    assert token not in source._staged
    assert not await asyncio.to_thread(path.exists)
    assert await source.async_resolve_media(
        MediaSourceItem.from_uri(hass, retained_id, None)
    )
    await source.async_close()


async def test_expired_blocked_writes_keep_all_attachment_slots_reserved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(media_source_module, "ATTACHMENT_TTL_SECONDS", 0.01)
    source = MaticPhotoMediaSource()
    started = threading.Event()
    resume = threading.Event()
    write_lock = threading.Lock()
    write_count = 0
    paths: list[Path] = []
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        nonlocal write_count
        with write_lock:
            write_count += 1
            if write_count == media_source_module.MAX_STAGED_ATTACHMENTS:
                started.set()
        paths.append(path)
        resume.wait(timeout=2)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    stages = [
        asyncio.create_task(
            source.async_stage_photo("entry", f"photo-{index}", b"image")
        )
        for index in range(media_source_module.MAX_STAGED_ATTACHMENTS)
    ]
    assert await asyncio.to_thread(started.wait, 1)
    assert len(source._staged) == media_source_module.MAX_STAGED_ATTACHMENTS
    await asyncio.sleep(0.03)

    with pytest.raises(ValueError, match="Too many"):
        await source.async_stage_photo("entry", "photo-overflow", b"image")

    assert len(source._staged) == media_source_module.MAX_STAGED_ATTACHMENTS
    resume.set()
    release_tasks = tuple(source._release_tasks.values())
    if release_tasks:
        await asyncio.gather(*release_tasks)
    stage_results = await asyncio.gather(*stages, return_exceptions=True)
    assert all(isinstance(result, ValueError) for result in stage_results)
    assert source._staged == {}
    assert all(not path.exists() for path in paths)
    await source.async_close()


async def test_staging_does_not_start_after_close_during_expiry_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(media_source_module, "ATTACHMENT_TTL_SECONDS", 0.01)
    source = MaticPhotoMediaSource()
    started = threading.Event()
    resume = threading.Event()
    write_count = 0
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        nonlocal write_count
        write_count += 1
        started.set()
        resume.wait(timeout=2)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    first_stage = asyncio.create_task(source.async_stage_photo("entry", "first", b"x"))
    assert await asyncio.to_thread(started.wait, 1)
    await asyncio.sleep(0.03)
    next_stage = asyncio.create_task(source.async_stage_photo("entry", "second", b"y"))
    await asyncio.sleep(0)
    close = asyncio.create_task(source.async_close())
    resume.set()

    await close
    await asyncio.gather(first_stage, return_exceptions=True)
    with pytest.raises(ValueError, match="unavailable"):
        await next_stage

    assert write_count == 1
    assert source._staged == {}


async def test_home_assistant_media_source_resolves_private_attachment(
    hass: HomeAssistant,
) -> None:
    assert await async_setup_component(hass, "media_source", {})
    hass.config.components.add("matic_robot")
    source = photo_attachment_source(hass)
    media_id = await source.async_stage_photo("entry", "photo", b"private bytes")

    resolved = await async_resolve_media(hass, media_id, None)

    assert resolved.path is not None
    assert await asyncio.to_thread(resolved.path.read_bytes) == b"private bytes"
    await source.async_close()


async def test_home_assistant_resolution_rechecks_after_concurrent_release(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert await async_setup_component(hass, "media_source", {})
    hass.config.components.add("matic_robot")
    source = photo_attachment_source(hass)
    media_id = await source.async_stage_photo("entry", "photo", b"private bytes")
    token = media_id.rsplit("/", maxsplit=1)[-1]
    path = source._staged[token].path
    observed = threading.Event()
    resume = threading.Event()
    original_is_file = Path.is_file

    def paused_is_file(target: Path) -> bool:
        was_present = original_is_file(target)
        observed.set()
        resume.wait(timeout=2)
        return was_present

    monkeypatch.setattr(Path, "is_file", paused_is_file)
    resolving = asyncio.create_task(async_resolve_media(hass, media_id, None))
    assert await asyncio.to_thread(observed.wait, 1)
    await source.async_release(media_id)
    assert not await asyncio.to_thread(path.exists)
    resume.set()

    with pytest.raises(Unresolvable):
        await resolving

    assert source._staged == {}
    await source.async_close()


async def test_ai_provider_failure_hides_details_and_releases_photo(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fail_with_private_detail(_hass: HomeAssistant, **_kwargs: Any) -> Any:
        raise RuntimeError("provider leaked secret photo annotations")

    source = photo_attachment_source(hass)
    monkeypatch.setattr(camera_ai, "_async_generate_data", fail_with_private_detail)

    with pytest.raises(HomeAssistantError) as raised:
        await camera_ai.async_answer_about_photo(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            _photo("photo", b"private image"),
            "What is shown?",
            "ai_task.selected",
            Context(),
        )

    assert raised.value.translation_key == "photo_patrol_ai_failed"
    assert "secret photo annotations" not in str(raised.value)
    assert source._staged == {}


@pytest.mark.parametrize("question", ["   ", "x" * (camera_ai.MAX_QUESTION_LENGTH + 1)])
async def test_ai_rejects_empty_and_overlong_questions(
    hass: HomeAssistant, question: str
) -> None:
    with pytest.raises(HomeAssistantError) as raised:
        await camera_ai.async_answer_about_photo(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            _photo("photo", b"image"),
            question,
            "ai_task.selected",
            Context(),
        )

    assert raised.value.translation_key == "photo_patrol_ai_question_invalid"


async def test_ai_rejects_non_ai_task_entity_id(hass: HomeAssistant) -> None:
    with pytest.raises(HomeAssistantError) as raised:
        await camera_ai.async_answer_about_photo(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            _photo("photo", b"image"),
            "What is shown?",
            "sensor.camera",
            Context(),
        )

    assert raised.value.translation_key == "photo_patrol_ai_unavailable"


@pytest.mark.parametrize(
    "data",
    [
        None,
        {"problem": 1, "summary": "Not a boolean."},
        {"problem": False, "summary": "  "},
        {"problem": False, "summary": "x" * (camera_ai.MAX_SUMMARY_LENGTH + 1)},
    ],
)
async def test_ai_rejects_invalid_structured_answers(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch, data: Any
) -> None:
    monkeypatch.setattr(
        camera_ai,
        "_async_generate_data",
        AsyncMock(return_value=SimpleNamespace(data=data)),
    )
    with pytest.raises(HomeAssistantError) as raised:
        await camera_ai.async_answer_about_photo(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            _photo("photo", b"image"),
            "What is shown?",
            "ai_task.selected",
            Context(),
        )

    assert raised.value.translation_key == "photo_patrol_ai_failed"
    assert photo_attachment_source(hass)._staged == {}


async def test_ai_task_entity_must_generate_data_and_accept_attachments() -> None:
    entity = SimpleNamespace(
        supported_features=(
            AITaskEntityFeature.GENERATE_DATA | AITaskEntityFeature.SUPPORT_ATTACHMENTS
        )
    )
    component = SimpleNamespace(get_entity=lambda entity_id: entity)
    hass = SimpleNamespace(data={DATA_COMPONENT: component})

    camera_ai.validate_ai_task_entity(hass, "ai_task.selected")

    for features in (
        AITaskEntityFeature.SUPPORT_ATTACHMENTS,
        AITaskEntityFeature.GENERATE_DATA,
    ):
        component.get_entity = lambda _entity_id, features=features: SimpleNamespace(
            supported_features=features
        )
        with pytest.raises(HomeAssistantError) as raised:
            camera_ai.validate_ai_task_entity(hass, "ai_task.selected")
        assert raised.value.translation_key == "photo_patrol_ai_unavailable"

    component.get_entity = lambda _entity_id: None
    with pytest.raises(HomeAssistantError):
        camera_ai.validate_ai_task_entity(hass, "ai_task.missing")


async def test_generate_data_lazy_wrapper_forwards_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hass = SimpleNamespace()
    expected = object()
    generate_data = AsyncMock(return_value=expected)
    ai_task_module = SimpleNamespace(async_generate_data=generate_data)
    monkeypatch.setitem(sys.modules, "homeassistant.components.ai_task", ai_task_module)

    result = await camera_ai._async_generate_data(
        hass, entity_id="ai_task.selected", attachments=[]
    )

    assert result is expected
    generate_data.assert_awaited_once_with(
        hass, entity_id="ai_task.selected", attachments=[]
    )


async def test_stage_rejects_closed_source_and_invalid_image_sizes() -> None:
    closed = MaticPhotoMediaSource()
    closed._closed = True
    with pytest.raises(ValueError, match="unavailable"):
        await closed.async_stage_photo("entry", "photo", b"image")
    closed._directory.cleanup()

    source = MaticPhotoMediaSource()
    for image in (b"", b"x" * (media_source_module.MAX_ATTACHMENT_BYTES + 1)):
        with pytest.raises(ValueError, match="size limit"):
            await source.async_stage_photo("entry", "photo", image)
    await source.async_close()


async def test_stage_rechecks_capacity_after_expiry_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MaticPhotoMediaSource()
    expiry_started = asyncio.Event()
    allow_expiry = asyncio.Event()
    original_expire = source._async_expire
    first_call = True

    async def delayed_first_expiry() -> None:
        nonlocal first_call
        if first_call:
            first_call = False
            expiry_started.set()
            await allow_expiry.wait()
            return
        await original_expire()

    monkeypatch.setattr(source, "_async_expire", delayed_first_expiry)
    delayed = asyncio.create_task(source.async_stage_photo("entry", "delayed", b"x"))
    await expiry_started.wait()
    admitted = await asyncio.gather(
        *(
            source.async_stage_photo("entry", f"admitted-{index}", b"x")
            for index in range(media_source_module.MAX_STAGED_ATTACHMENTS)
        )
    )
    allow_expiry.set()

    with pytest.raises(ValueError, match="Too many"):
        await delayed
    assert len(source._staged) == media_source_module.MAX_STAGED_ATTACHMENTS
    await asyncio.gather(*(source.async_release(media_id) for media_id in admitted))
    await source.async_close()


async def test_stage_expiry_race_removes_a_file_written_after_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MaticPhotoMediaSource()
    original_write = Path.write_bytes

    def close_before_write_finishes(path: Path, payload: bytes) -> int:
        source._closed = True
        return original_write(path, payload)

    monkeypatch.setattr(Path, "write_bytes", close_before_write_finishes)
    with pytest.raises(ValueError, match=r"runtime changed|expired before use"):
        await source.async_stage_photo("entry", "photo", b"image")

    assert source._staged == {}
    source._directory.cleanup()


async def test_resolve_media_rejects_expired_and_missing_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MaticPhotoMediaSource()
    expired_id = await source.async_stage_photo("entry", "expired", b"image")
    expired_token = expired_id.rsplit("/", maxsplit=1)[-1]
    original_monotonic = media_source_module.monotonic
    clock = [original_monotonic()]
    monkeypatch.setattr(media_source_module, "monotonic", lambda: clock[0])
    clock[0] = source._staged[expired_token].expires_at + 1
    refreshed_id = await source.async_stage_photo("entry", "refreshed", b"image")
    assert expired_token not in source._staged

    refreshed_token = refreshed_id.rsplit("/", maxsplit=1)[-1]
    clock[0] = source._staged[refreshed_token].expires_at + 1
    with pytest.raises(Unresolvable):
        await source.async_resolve_media(
            MediaSourceItem.from_uri(None, refreshed_id, None)  # type: ignore[arg-type]
        )
    assert refreshed_token not in source._staged

    monkeypatch.setattr(media_source_module, "monotonic", original_monotonic)
    missing_id = await source.async_stage_photo("entry", "missing", b"image")
    missing_token = missing_id.rsplit("/", maxsplit=1)[-1]
    missing_path = source._staged[missing_token].path
    await asyncio.to_thread(missing_path.unlink)
    with pytest.raises(Unresolvable):
        await source.async_resolve_media(
            MediaSourceItem.from_uri(None, missing_id, None)  # type: ignore[arg-type]
        )
    assert missing_token not in source._staged
    await source.async_close()


async def test_release_swallows_failed_pending_write_and_joins_cleanup() -> None:
    source = MaticPhotoMediaSource()
    media_id = await source.async_stage_photo("entry", "photo", b"image")
    token = media_id.rsplit("/", maxsplit=1)[-1]
    failed_write = asyncio.get_running_loop().create_future()
    failed_write.set_exception(RuntimeError("synthetic write failure"))
    source._writes[token] = failed_write

    await source.async_release(media_id)

    assert source._staged == {}
    assert source._writes == {}
    await source.async_close()


async def test_failed_executor_write_is_joined_then_removed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MaticPhotoMediaSource()

    def fail_write(_path: Path, _payload: bytes) -> int:
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(Path, "write_bytes", fail_write)
    with pytest.raises(OSError, match="synthetic disk failure"):
        await source.async_stage_photo("entry", "photo", b"image")

    assert source._staged == {}
    assert source._writes == {}
    await source.async_close()


async def test_private_source_cannot_be_browsed_or_searched() -> None:
    source = MaticPhotoMediaSource()
    with pytest.raises(Unresolvable):
        await source.async_browse_media(None)  # type: ignore[arg-type]
    with pytest.raises(media_source_module.SearchError):
        await source.async_search_media(
            None,
            SearchMediaQuery(search_query="photo"),  # type: ignore[arg-type]
        )
    await source.async_close()


async def test_source_close_is_idempotent_and_waits_for_cleanup_task() -> None:
    source = MaticPhotoMediaSource()
    cleanup_started = asyncio.Event()
    allow_cleanup = asyncio.Event()

    async def pending_cleanup() -> None:
        cleanup_started.set()
        await allow_cleanup.wait()

    cleanup = asyncio.create_task(pending_cleanup())
    cleanup.add_done_callback(source._forget_cleanup_task)
    source._cleanup_tasks.add(cleanup)
    closing = asyncio.create_task(source.async_close())
    await cleanup_started.wait()
    await asyncio.sleep(0)
    assert not closing.done()
    allow_cleanup.set()

    await closing
    await source.async_close()

    assert source._staged == {}
    assert source._cleanup_tasks == set()


async def test_cancelled_internal_release_keeps_reservation_until_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MaticPhotoMediaSource()
    started = threading.Event()
    resume = threading.Event()
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=2)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    stage = asyncio.create_task(source.async_stage_photo("entry", "photo", b"image"))
    assert await asyncio.to_thread(started.wait, 1)
    token = next(iter(source._staged))
    media_id = f"media-source://matic_robot/{token}"
    release_wrapper = asyncio.create_task(source.async_release(media_id))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    cleanup = source._release_tasks[token]
    cleanup.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cleanup
    with pytest.raises(asyncio.CancelledError):
        await release_wrapper

    assert token in source._staged
    assert len(source._staged) == 1
    resume.set()
    await asyncio.gather(stage, return_exceptions=True)
    await source.async_release(media_id)

    assert source._staged == {}
    await source.async_close()


async def test_media_source_platform_reuses_the_private_source() -> None:
    bus = SimpleNamespace(async_listen_once=MagicMock())
    hass = SimpleNamespace(data={}, bus=bus)

    first = await async_get_media_source(hass)
    second = await async_get_media_source(hass)

    assert first is second
    bus.async_listen_once.assert_called_once()
    await first.async_close()  # type: ignore[attr-defined]


async def test_take_photo_assist_tool_returns_only_bounded_photo_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = MaticTakePhotoTool()
    hass, service_call = _prepare_camera_tool(monkeypatch, tool)
    service_call.return_value = {
        "robots": [
            {
                "photos": [
                    {
                        "photo_id": "photo-one",
                        "captured_at": "2026-10-31T12:00:00Z",
                        "preview_url": "/api/matic_robot/photo/entry/photo-one",
                        "url": "/api/matic_robot/photo/entry/photo-one?full=1",
                        "unbounded": "must not be returned",
                    }
                ]
            }
        ]
    }

    result = await tool.async_run(hass, {"room": "Kitchen"}, _llm_context())

    assert result.data == {
        "taken": True,
        "photo": {
            "photo_id": "photo-one",
            "captured_at": "2026-10-31T12:00:00Z",
            "preview_url": "/api/matic_robot/photo/entry/photo-one",
        },
        "preview_only": True,
    }
    assert service_call.await_args.args[:2] == ("matic_robot", "photo_patrol")
    assert service_call.await_args.args[2] == {
        "entity_id": "vacuum.matic",
        "rooms": ["Kitchen"],
    }


@pytest.mark.parametrize(
    "response",
    [
        {},
        {"robots": "not a list"},
        {"robots": []},
        {"robots": [None]},
        {"robots": [{}]},
        {"robots": [{"photos": "not a list"}]},
        {"robots": [{"photos": []}]},
        {"robots": [{"photos": [None]}]},
    ],
)
async def test_take_photo_tool_reports_no_photo_for_malformed_response(
    monkeypatch: pytest.MonkeyPatch, response: dict[str, Any]
) -> None:
    tool = MaticTakePhotoTool()
    hass, service_call = _prepare_camera_tool(monkeypatch, tool)
    service_call.return_value = response

    result = await tool.async_run(hass, {"room": "Kitchen"}, _llm_context())

    assert result.data == {"taken": False, "photo": None, "preview_only": True}


async def test_investigate_tool_returns_analysis_without_full_photo_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = MaticInvestigateTool()
    hass, service_call = _prepare_camera_tool(monkeypatch, tool)
    service_call.return_value = {
        "robots": [
            {
                "photos": [
                    {
                        "photo_id": "photo-one",
                        "preview_url": "/api/matic_robot/photo/entry/photo-one",
                        "url": "/api/matic_robot/photo/entry/photo-one?full=1",
                        "analysis": {"problem": True, "summary": "Water is visible."},
                    }
                ]
            }
        ]
    }

    result = await tool.async_run(
        hass,
        {
            "room": "Kitchen",
            "question": "Is water visible?",
            "ai_task_entity_id": "ai_task.selected",
        },
        _llm_context(),
    )

    assert result.data == {
        "done": True,
        "photo_id": "photo-one",
        "preview_url": "/api/matic_robot/photo/entry/photo-one",
        "analysis": {"problem": True, "summary": "Water is visible."},
    }
    assert service_call.await_args.args[2] == {
        "entity_id": "vacuum.matic",
        "rooms": ["Kitchen"],
        "question": "Is water visible?",
        "ai_task_entity_id": "ai_task.selected",
    }


async def test_investigate_tool_fails_closed_without_photo_analysis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = MaticInvestigateTool()
    hass, service_call = _prepare_camera_tool(monkeypatch, tool)
    service_call.return_value = {"robots": [{"photos": [{"photo_id": "photo"}]}]}

    result = await tool.async_run(
        hass,
        {
            "room": "Kitchen",
            "question": "Is water visible?",
            "ai_task_entity_id": "ai_task.selected",
        },
        _llm_context(),
    )

    assert result.error is True
    assert result.data == {
        "done": False,
        "reason": "The photo investigation returned no answer.",
    }


@pytest.mark.parametrize("tool_type", [MaticTakePhotoTool, MaticInvestigateTool])
async def test_camera_assist_tools_use_generic_service_refusal(
    monkeypatch: pytest.MonkeyPatch,
    tool_type: type[MaticTakePhotoTool] | type[MaticInvestigateTool],
) -> None:
    tool = tool_type()
    hass, service_call = _prepare_camera_tool(monkeypatch, tool)
    service_call.side_effect = HomeAssistantError("private provider detail")
    refusal = llm.ToolResult(data={"reason": "Photo tool unavailable."}, error=True)
    refusal_handler = AsyncMock(return_value=refusal)
    monkeypatch.setattr(llm_camera, "_async_service_refusal", refusal_handler)
    args = {"room": "Kitchen"}
    if tool_type is MaticInvestigateTool:
        args.update(question="Is water visible?", ai_task_entity_id="ai_task.selected")

    result = await tool.async_run(hass, args, _llm_context())

    assert result is refusal
    refusal_handler.assert_awaited_once()


async def test_photo_analysis_requires_question_and_entity_before_robot_access() -> (
    None
):
    hass = SimpleNamespace(services=SimpleNamespace(async_call=pytest.fail))

    with pytest.raises(HomeAssistantError) as raised:
        await photo_patrol.async_photo_patrol(
            hass,
            SimpleNamespace(entry_id="entry-one"),
            "vacuum.matic",
            ["Kitchen"],
            question="Is water visible?",
        )

    assert raised.value.translation_key == "photo_patrol_ai_question_required"


async def test_photo_assist_tool_refuses_non_admin_before_service_call() -> None:
    service_call = AsyncMock()
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=AsyncMock(return_value=None)),
        services=SimpleNamespace(async_call=service_call),
    )
    context = llm.LLMContext(
        platform="assist",
        context=Context(user_id="member"),
        language="en",
        assistant="conversation",
        device_id=None,
    )

    with pytest.raises(HomeAssistantError) as raised:
        await MaticTakePhotoTool().async_call(
            hass,
            llm.ToolInput("MaticTakePhoto", {"room": "Kitchen"}),
            context,
        )

    assert raised.value.translation_key == "llm_admin_required"
    service_call.assert_not_awaited()
