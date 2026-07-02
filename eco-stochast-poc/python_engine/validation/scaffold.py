"""Validation protocol scaffold for presence-only landslide labels.

This module follows docs/MODEL_CARD.md §7-§8:
- labels are presence-only, biased, and incomplete;
- train/test splits are temporal, never random;
- event-based rainfall backtesting is required;
- A25 Tier 0 is the mandatory baseline.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

from features.a25 import A25Record, classify_a25, compute_a25
from loaders.rainfall import RainfallRecord, generate_synthetic_rainfall


ALERT_SCORE = {
    "LOW": 0.05,
    "MEDIUM": 0.25,
    "HIGH": 0.55,
    "CRITICAL": 0.85,
}


@dataclass(frozen=True)
class ValidationExample:
    day: date
    observed_label: int
    label_is_presence_only: bool
    model_score: float
    uncertainty_low: float
    uncertainty_high: float
    alert_level: str
    a25_mm: float
    a25_score: float
    a25_alert_level: str


@dataclass(frozen=True)
class RainfallEventWindow:
    start_day: date
    end_day: date
    peak_a25_mm: float
    observed_event_day: date | None
    first_alert_day: date | None


@dataclass(frozen=True)
class TemporalSplit:
    train: list[ValidationExample]
    test: list[ValidationExample]
    train_years: tuple[int, ...]
    test_years: tuple[int, ...]
    warning: str


def temporal_train_test_split(examples: Iterable[ValidationExample], *, test_start_year: int) -> TemporalSplit:
    """Split by time to avoid leakage from the same rainfall seasons/events.

    Random splits are intentionally not implemented: nearby days share rainfall
    memory and event context, so shuffling would leak future hydrologic state.
    """

    ordered = sorted(examples, key=lambda example: example.day)
    train = [example for example in ordered if example.day.year < test_start_year]
    test = [example for example in ordered if example.day.year >= test_start_year]
    return TemporalSplit(
        train=train,
        test=test,
        train_years=tuple(sorted({example.day.year for example in train})),
        test_years=tuple(sorted({example.day.year for example in test})),
        warning="Temporal split only; random split is prohibited because rainfall memory creates leakage.",
    )


def rainfall_event_backtest_windows(
    a25_records: Iterable[A25Record],
    labels_by_day: dict[date, int],
    *,
    event_threshold_mm: float = 200.0,
) -> list[RainfallEventWindow]:
    """Group contiguous A25-threshold exceedances into rainfall event windows."""

    records = sorted(a25_records, key=lambda record: record.day)
    windows: list[RainfallEventWindow] = []
    active: list[A25Record] = []

    for record in records:
        if record.a25_mm >= event_threshold_mm:
            active.append(record)
            continue
        if active:
            windows.append(_window_from_records(active, labels_by_day))
            active = []

    if active:
        windows.append(_window_from_records(active, labels_by_day))

    return windows


def precision_recall_at_threshold(examples: Iterable[ValidationExample], *, threshold: float) -> dict[str, float]:
    rows = list(examples)
    predicted = [example.model_score >= threshold for example in rows]
    observed = [example.observed_label == 1 for example in rows]
    true_positive = sum(1 for pred, obs in zip(predicted, observed) if pred and obs)
    false_positive = sum(1 for pred, obs in zip(predicted, observed) if pred and not obs)
    false_negative = sum(1 for pred, obs in zip(predicted, observed) if not pred and obs)
    precision = _safe_div(true_positive, true_positive + false_positive)
    recall = _safe_div(true_positive, true_positive + false_negative)
    return {"precision": precision, "recall": recall}


def pr_auc(examples: Iterable[ValidationExample], *, score_field: str = "model_score") -> float:
    rows = sorted(list(examples), key=lambda example: getattr(example, score_field), reverse=True)
    positives = sum(example.observed_label for example in rows)
    if positives == 0:
        return 0.0

    area = 0.0
    previous_recall = 0.0
    true_positive = 0
    false_positive = 0

    for example in rows:
        if example.observed_label:
            true_positive += 1
        else:
            false_positive += 1
        recall = true_positive / positives
        precision = true_positive / (true_positive + false_positive)
        area += precision * (recall - previous_recall)
        previous_recall = recall

    return round(area, 6)


def brier_score(examples: Iterable[ValidationExample], *, score_field: str = "model_score") -> float:
    rows = list(examples)
    if not rows:
        return 0.0
    return round(
        sum((getattr(example, score_field) - example.observed_label) ** 2 for example in rows) / len(rows),
        6,
    )


def calibration_curve(examples: Iterable[ValidationExample], *, bins: int = 5) -> list[dict[str, float]]:
    rows = list(examples)
    if bins <= 0:
        raise ValueError("bins must be positive")

    result: list[dict[str, float]] = []
    for index in range(bins):
        lower = index / bins
        upper = (index + 1) / bins
        if index == bins - 1:
            bucket = [example for example in rows if lower <= example.model_score <= upper]
        else:
            bucket = [example for example in rows if lower <= example.model_score < upper]
        if not bucket:
            continue
        result.append(
            {
                "bin_low": round(lower, 6),
                "bin_high": round(upper, 6),
                "mean_score": round(sum(example.model_score for example in bucket) / len(bucket), 6),
                "observed_rate": round(sum(example.observed_label for example in bucket) / len(bucket), 6),
                "n": float(len(bucket)),
            }
        )
    return result


def false_alarm_rate(examples: Iterable[ValidationExample], *, threshold: float) -> float:
    rows = list(examples)
    predicted_positive = [example for example in rows if example.model_score >= threshold]
    if not predicted_positive:
        return 0.0
    false_alarms = sum(1 for example in predicted_positive if example.observed_label == 0)
    return round(false_alarms / len(predicted_positive), 6)


def missed_event_rate(examples: Iterable[ValidationExample], *, threshold: float) -> float:
    observed_positive = [example for example in examples if example.observed_label == 1]
    if not observed_positive:
        return 0.0
    misses = sum(1 for example in observed_positive if example.model_score < threshold)
    return round(misses / len(observed_positive), 6)


def mean_lead_time_days(windows: Iterable[RainfallEventWindow]) -> float | None:
    lead_times = [
        (window.observed_event_day - window.first_alert_day).days
        for window in windows
        if window.observed_event_day is not None
        and window.first_alert_day is not None
        and window.first_alert_day <= window.observed_event_day
    ]
    if not lead_times:
        return None
    return round(sum(lead_times) / len(lead_times), 6)


def alert_threshold_evaluation(examples: Iterable[ValidationExample]) -> dict[str, dict[str, float]]:
    return {
        alert: precision_recall_at_threshold(examples, threshold=score)
        for alert, score in ALERT_SCORE.items()
        if alert != "LOW"
    }


def uncertainty_coverage(examples: Iterable[ValidationExample]) -> float:
    rows = list(examples)
    if not rows:
        return 0.0
    covered = sum(
        1
        for example in rows
        if example.uncertainty_low <= example.observed_label <= example.uncertainty_high
    )
    return round(covered / len(rows), 6)


def compare_against_a25(examples: Iterable[ValidationExample]) -> dict[str, object]:
    rows = list(examples)
    model_pr_auc = pr_auc(rows, score_field="model_score")
    a25_pr_auc = pr_auc(rows, score_field="a25_score")
    return {
        "model": {
            "pr_auc": model_pr_auc,
            "brier_score": brier_score(rows, score_field="model_score"),
        },
        "a25_baseline": {
            "pr_auc": a25_pr_auc,
            "brier_score": brier_score(rows, score_field="a25_score"),
        },
        "beat_a25": model_pr_auc > a25_pr_auc,
        "claim_bar": "Any performance claim must beat the Tier 0 A25 baseline.",
    }


def build_validation_report(examples: Iterable[ValidationExample], windows: Iterable[RainfallEventWindow]) -> dict[str, object]:
    rows = list(examples)
    event_windows = list(windows)
    return {
        "label_warning": (
            "Presence-only, biased, incomplete labels: unlabeled windows are not proven true negatives, "
            "and naive accuracy is intentionally omitted."
        ),
        "metrics": {
            **precision_recall_at_threshold(rows, threshold=ALERT_SCORE["HIGH"]),
            "pr_auc": pr_auc(rows),
            "brier_score": brier_score(rows),
            "calibration_curve": calibration_curve(rows),
            "lead_time_days": mean_lead_time_days(event_windows),
            "false_alarm_rate": false_alarm_rate(rows, threshold=ALERT_SCORE["HIGH"]),
            "missed_event_rate": missed_event_rate(rows, threshold=ALERT_SCORE["HIGH"]),
            "alert_thresholds": alert_threshold_evaluation(rows),
            "uncertainty_coverage": uncertainty_coverage(rows),
        },
        "a25_comparison": compare_against_a25(rows),
    }


def build_synthetic_presence_only_dataset(*, seed: int = 7, days: int = 900) -> tuple[list[ValidationExample], list[A25Record]]:
    """Create reproducible synthetic examples through the Stage 5 rainfall loader.

    Synthetic labels emulate incomplete reporting for notebook/test execution.
    They are not a substitute for SIMMA calibration labels.
    """

    rainfall = generate_synthetic_rainfall(seed=seed, days=days)
    a25_records = compute_a25(rainfall)
    examples: list[ValidationExample] = []

    for index, record in enumerate(a25_records):
        latent_event = record.a25_mm >= 260.0 and index % 11 in (0, 1, 2)
        reported = latent_event and index % 4 != 0
        a25_score = _a25_score(record.a25_mm)
        model_score = min(max(a25_score + (0.08 if index % 13 == 0 else -0.03), 0.01), 0.98)
        examples.append(
            ValidationExample(
                day=record.day,
                observed_label=1 if reported else 0,
                label_is_presence_only=True,
                model_score=round(model_score, 6),
                uncertainty_low=round(max(model_score - 0.18, 0.0), 6),
                uncertainty_high=round(min(model_score + 0.18, 1.0), 6),
                alert_level=_score_to_alert(model_score),
                a25_mm=record.a25_mm,
                a25_score=a25_score,
                a25_alert_level=record.alert,
            )
        )

    return examples, a25_records


def _window_from_records(records: list[A25Record], labels_by_day: dict[date, int]) -> RainfallEventWindow:
    event_day = next((record.day for record in records if labels_by_day.get(record.day) == 1), None)
    first_alert_day = records[0].day if records else None
    return RainfallEventWindow(
        start_day=records[0].day,
        end_day=records[-1].day,
        peak_a25_mm=max(record.a25_mm for record in records),
        observed_event_day=event_day,
        first_alert_day=first_alert_day,
    )


def _a25_score(a25_mm: float) -> float:
    alert = classify_a25(a25_mm)
    return ALERT_SCORE[alert]


def _score_to_alert(score: float) -> str:
    if score >= ALERT_SCORE["CRITICAL"]:
        return "CRITICAL"
    if score >= ALERT_SCORE["HIGH"]:
        return "HIGH"
    if score >= ALERT_SCORE["MEDIUM"]:
        return "MEDIUM"
    return "LOW"


def _safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return round(numerator / denominator, 6)
