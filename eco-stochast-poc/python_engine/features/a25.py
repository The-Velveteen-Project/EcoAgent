"""A25 antecedent rainfall baseline from MODEL_CARD.md and DATA_SOURCES.md."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Iterable, Protocol


A25_WINDOW_DAYS = 25
A25_YELLOW_MM = 200.0
A25_ORANGE_MM = 300.0
A25_RED_MM = 400.0


class HasRainfall(Protocol):
    timestamp: datetime
    rainfall_mm: float


@dataclass(frozen=True)
class A25Record:
    day: date
    rainfall_mm: float
    a25_mm: float
    alert: str


def classify_a25(a25_mm: float) -> str:
    """Classify A25 with IDEA operational thresholds: 200/300/400 mm."""

    if a25_mm >= A25_RED_MM:
        return "CRITICAL"
    if a25_mm >= A25_ORANGE_MM:
        return "HIGH"
    if a25_mm >= A25_YELLOW_MM:
        return "MEDIUM"
    return "LOW"


def compute_a25(records: Iterable[HasRainfall]) -> list[A25Record]:
    """Compute daily 25-day accumulated rainfall.

    Multiple observations per day are summed before the rolling accumulation.
    """

    daily: dict[date, float] = {}
    for record in records:
        day = record.timestamp.date()
        daily[day] = daily.get(day, 0.0) + float(record.rainfall_mm)

    results: list[A25Record] = []
    for day in sorted(daily):
        window_start = day - timedelta(days=A25_WINDOW_DAYS - 1)
        a25 = sum(rain for rain_day, rain in daily.items() if window_start <= rain_day <= day)
        results.append(
            A25Record(
                day=day,
                rainfall_mm=round(daily[day], 6),
                a25_mm=round(a25, 6),
                alert=classify_a25(a25),
            )
        )
    return results

