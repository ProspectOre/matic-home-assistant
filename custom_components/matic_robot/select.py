"""Cleaning preferences for Matic Hermes."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.commands import CleaningMode, CoverageSetting
from .const import CONF_CLEANING_MODE, CONF_COVERAGE_SETTING
from .entity import MaticEntity

PARALLEL_UPDATES = 0

CLEANING_MODE_DESCRIPTION = SelectEntityDescription(
    key=CONF_CLEANING_MODE,
    translation_key=CONF_CLEANING_MODE,
)

COVERAGE_DESCRIPTION = SelectEntityDescription(
    key=CONF_COVERAGE_SETTING,
    translation_key=CONF_COVERAGE_SETTING,
)

SAVED_PLAN_DESCRIPTION = SelectEntityDescription(
    key="saved_cleaning_plan",
    translation_key="saved_cleaning_plan",
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Matic cleaning preferences."""
    async_add_entities(
        [
            MaticCleaningModeSelect(entry),
            MaticCoverageSettingSelect(entry),
            MaticSavedPlanSelect(entry),
        ]
    )


class MaticCleaningModeSelect(MaticEntity, SelectEntity):
    """Choose the mode used for the next full-floor or room clean."""

    entity_description = CLEANING_MODE_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_options = [value.value for value in CleaningMode]
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_cleaning_mode"
        )

    @property
    def current_option(self) -> str:
        """Return the mode for the next clean."""
        return self.coordinator.cleaning_mode.value

    async def async_select_option(self, option: str) -> None:
        """Set the mode for the next clean."""
        self.coordinator.cleaning_mode = CleaningMode(option)
        options = dict(self._config_entry.options)
        options[CONF_CLEANING_MODE] = option
        self.hass.config_entries.async_update_entry(self._config_entry, options=options)
        self.async_write_ha_state()


class MaticCoverageSettingSelect(MaticEntity, SelectEntity):
    """Choose the coverage pass used for the next clean."""

    entity_description = COVERAGE_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_options = [value.value for value in CoverageSetting]
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_coverage"

    @property
    def current_option(self) -> str:
        """Return the coverage pass for the next clean."""
        return self.coordinator.coverage_setting.value

    async def async_select_option(self, option: str) -> None:
        """Set the coverage pass for the next clean."""
        self.coordinator.coverage_setting = CoverageSetting(option)
        options = dict(self._config_entry.options)
        options[CONF_COVERAGE_SETTING] = option
        self.hass.config_entries.async_update_entry(self._config_entry, options=options)
        self.async_write_ha_state()


class MaticSavedPlanSelect(MaticEntity, SelectEntity):
    """Choose the named saved plan used by run/preview/retry entities."""

    entity_description = SAVED_PLAN_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._serial_number = self.coordinator.data.info.serial_number
        self._history = entry.runtime_data.cleaning_plans
        self._attr_unique_id = f"{self._serial_number}_saved_cleaning_plan"

    async def async_added_to_hass(self) -> None:
        """Subscribe to saved-plan changes."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._history.async_add_listener(
                self._serial_number, self._async_plans_updated
            )
        )

    @callback
    def _async_plans_updated(self) -> None:
        self.async_write_ha_state()

    @property
    def options(self) -> list[str]:
        """Return enabled human-readable plan names."""
        return [
            plan.get("name", plan_id)
            for plan_id, plan in self._history.plans(self._serial_number).items()
            if plan.get("enabled", True)
        ]

    @property
    def current_option(self) -> str | None:
        """Return the selected plan's human-readable name."""
        value = self._history.snapshot(self._serial_number)["selected_plan_name"]
        return str(value) if value is not None else None

    async def async_select_option(self, option: str) -> None:
        """Select a saved plan by its displayed name."""
        plan = self._history.plan(self._serial_number, option)
        await self._history.async_select_plan(self._serial_number, plan["id"])
