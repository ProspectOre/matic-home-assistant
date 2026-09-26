"""Verified per-room cadence policy tests."""

from __future__ import annotations

import pytest

from custom_components.matic_robot.cadence import (
    advance_cadence,
    cadence_snapshot,
    normalize_cadence_policy,
)


def test_normalize_cadence_policy_accepts_independent_rules() -> None:
    assert normalize_cadence_policy(
        {
            "scope": "shared",
            "mop_every_n": 3,
            "coverage_every_n": 2,
            "periodic_coverage_setting": "heavy_duty",
            "do_mop_next": True,
        },
        cleaning_mode="vacuum",
        coverage_setting="standard",
    ) == {
        "scope": "shared",
        "mop_every_n": 3,
        "coverage_every_n": 2,
        "periodic_coverage_setting": "heavy_duty",
        "do_mop_next": True,
        "do_coverage_next": False,
    }


@pytest.mark.parametrize(
    ("policy", "mode", "coverage", "message"),
    [
        ("not-an-object", "vacuum", "standard", "must be an object"),
        ({"scope": "robot"}, "vacuum", "standard", "scope"),
        ({"mop_every_n": True}, "vacuum", "standard", "between 1 and 100"),
        ({"coverage_every_n": 2}, "vacuum", "standard", "periodic coverage"),
        (
            {"mop_every_n": 3},
            "mop",
            "standard",
            "mop cadence requires vacuum",
        ),
        (
            {"coverage_every_n": 3, "periodic_coverage_setting": "turbo"},
            "vacuum",
            "standard",
            "periodic coverage",
        ),
        ({}, "vacuum", "invalid", "coverage setting"),
    ],
)
def test_normalize_cadence_policy_rejects_invalid_input(
    policy: object, mode: str, coverage: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        normalize_cadence_policy(
            policy,
            cleaning_mode=mode,
            coverage_setting=coverage,
        )


@pytest.mark.parametrize("field", ["do_mop_next", "do_coverage_next"])
@pytest.mark.parametrize("value", [None, 0, 1, "true"])
def test_normalize_cadence_policy_rejects_non_boolean_one_shot_flags(
    field: str, value: object
) -> None:
    with pytest.raises(ValueError, match=f"{field} must be a boolean"):
        normalize_cadence_policy(
            {field: value},
            cleaning_mode="vacuum",
            coverage_setting="standard",
        )


def test_normalize_cadence_policy_defaults_absent_one_shot_flags() -> None:
    policy = normalize_cadence_policy(
        {}, cleaning_mode="vacuum", coverage_setting="standard"
    )

    assert policy["do_mop_next"] is False
    assert policy["do_coverage_next"] is False


def test_interval_one_is_due_on_first_clean_and_empty_policy_is_inactive() -> None:
    assert (
        normalize_cadence_policy(
            None, cleaning_mode="vacuum", coverage_setting="standard"
        )["scope"]
        == "plan"
    )
    policy = normalize_cadence_policy(
        {"mop_every_n": 1},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    due = cadence_snapshot(
        policy, None, cleaning_mode="vacuum", coverage_setting="standard"
    )
    assert due["mop_due"] is True
    assert due["next_mop_in"] == 1
    assert due["effective_cleaning_mode"] == "vacuum_and_mop"
    assert advance_cadence(
        due, None, verified_mode="vacuum_and_mop", verified_coverage="standard"
    ) == {"mop": 0, "coverage": 0}

    inactive = normalize_cadence_policy(
        {}, cleaning_mode="vacuum", coverage_setting="quick"
    )
    snapshot = cadence_snapshot(
        inactive,
        {"mop": True, "coverage": -3},
        cleaning_mode="vacuum",
        coverage_setting="quick",
    )
    assert snapshot["mop_due"] is False
    assert snapshot["coverage_due"] is False
    assert snapshot["mop_progress"] == 0
    assert snapshot["coverage_progress"] == 0
    assert snapshot["next_mop_in"] is None
    assert snapshot["next_coverage_in"] is None


def test_nth_verified_clean_is_due_and_both_rules_combine() -> None:
    policy = normalize_cadence_policy(
        {
            "mop_every_n": 3,
            "coverage_every_n": 3,
            "periodic_coverage_setting": "heavy_duty",
        },
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    first = cadence_snapshot(
        policy, None, cleaning_mode="vacuum", coverage_setting="standard"
    )
    assert advance_cadence(
        first, None, verified_mode="vacuum", verified_coverage="standard"
    ) == {"mop": 1, "coverage": 1}
    second = cadence_snapshot(
        policy,
        {"mop": 1, "coverage": 1},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    assert second["mop_due"] is False
    assert second["next_mop_in"] == 2
    assert advance_cadence(
        second,
        {"mop": 1, "coverage": 1},
        verified_mode="vacuum",
        verified_coverage="standard",
    ) == {"mop": 2, "coverage": 2}
    third = cadence_snapshot(
        policy,
        {"mop": 2, "coverage": 2},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    assert third["mop_due"] is True
    assert third["coverage_due"] is True
    assert third["effective_cleaning_mode"] == "vacuum_and_mop"
    assert third["effective_coverage_setting"] == "heavy_duty"
    assert advance_cadence(
        third,
        {"mop": 2, "coverage": 2},
        verified_mode="vacuum_and_mop",
        verified_coverage="heavy_duty",
    ) == {"mop": 0, "coverage": 0}


def test_due_work_remains_due_until_effective_modes_are_verified() -> None:
    policy = normalize_cadence_policy(
        {
            "mop_every_n": 2,
            "coverage_every_n": 2,
            "periodic_coverage_setting": "quick",
        },
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    due = cadence_snapshot(
        policy,
        {"mop": 1, "coverage": 1},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    assert advance_cadence(
        due,
        {"mop": 1, "coverage": 1},
        verified_mode="vacuum",
        verified_coverage="standard",
    ) == {"mop": 1, "coverage": 1}


def test_do_next_is_independent_and_satisfied_dimension_resets_only_it() -> None:
    policy = normalize_cadence_policy(
        {
            "mop_every_n": 5,
            "coverage_every_n": 4,
            "periodic_coverage_setting": "quick",
            "do_mop_next": True,
            "do_coverage_next": True,
        },
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    due = cadence_snapshot(
        policy,
        {"mop": 3, "coverage": 2},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    assert due["mop_due"] is True
    assert due["coverage_due"] is True
    assert advance_cadence(
        due,
        {"mop": 3, "coverage": 2},
        verified_mode="vacuum_and_mop",
        verified_coverage="standard",
    ) == {"mop": 0, "coverage": 3}


def test_progress_is_clamped_before_calculating_due_work() -> None:
    policy = normalize_cadence_policy(
        {"coverage_every_n": 100, "periodic_coverage_setting": "quick"},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    snapshot = cadence_snapshot(
        policy,
        {"coverage": 1_000_000},
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    assert snapshot["coverage_progress"] == 100
    assert snapshot["coverage_due"] is True
    assert advance_cadence(
        snapshot,
        {"coverage": 1_000_000},
        verified_mode="vacuum",
        verified_coverage="quick",
    ) == {"mop": 0, "coverage": 0}
