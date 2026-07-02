"""Rainfall time-series loading constrained by docs/DATA_SOURCES.md.

DATA_SOURCES.md §A documents IDEA-UNAL / SIMAC as the preferred local forcing
source, but it also states that no public API is documented. This module
therefore supports local CSV/export files and an explicit synthetic generator
for tests and development only.
"""

from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class RainfallRecord:
    timestamp: datetime
    rainfall_mm: float
    station_id: str | None = None


DEFAULT_TIMESTAMP_COLUMNS = ("timestamp", "datetime", "date", "fecha", "fecha_hora")
DEFAULT_RAIN_COLUMNS = ("rainfall_mm", "precipitation_mm", "rain_mm", "lluvia_mm", "precipitacion_mm")
DEFAULT_STATION_COLUMNS = ("station_id", "station", "estacion", "codigo_estacion")


def load_rainfall_csv(
    path: str | Path,
    *,
    timestamp_column: str | None = None,
    rainfall_column: str | None = None,
    station_column: str | None = None,
) -> list[RainfallRecord]:
    """Load rainfall from a local IDEA/SIMAC-style CSV export.

    No SIMAC endpoint is hardcoded because docs/DATA_SOURCES.md §A explicitly
    says the public API is undocumented.
    """

    csv_path = Path(path)
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"Rainfall CSV has no header: {csv_path}")

        headers = tuple(reader.fieldnames)
        timestamp_key = timestamp_column or _first_present(headers, DEFAULT_TIMESTAMP_COLUMNS, "timestamp")
        rainfall_key = rainfall_column or _first_present(headers, DEFAULT_RAIN_COLUMNS, "rainfall")
        station_key = station_column or _first_present_optional(headers, DEFAULT_STATION_COLUMNS)

        records = [
            RainfallRecord(
                timestamp=_parse_datetime(row[timestamp_key]),
                rainfall_mm=_parse_non_negative_float(row[rainfall_key], rainfall_key),
                station_id=(row.get(station_key, "").strip() or None) if station_key else None,
            )
            for row in reader
            if row.get(timestamp_key) and row.get(rainfall_key)
        ]

    return sorted(records, key=lambda record: record.timestamp)


def load_rainfall_series(path: str | Path | None = None, *, seed: int = 1, days: int = 30) -> list[RainfallRecord]:
    """Load real rainfall when a local export exists, otherwise return synthetic data.

    TODO(verify): replace the synthetic branch with a verified IDEA/SIMAC
    integration after confirming access through the SIMAC geoportal documented
    in docs/DATA_SOURCES.md §A.
    """

    if path is not None and Path(path).exists():
        return load_rainfall_csv(path)
    return generate_synthetic_rainfall(seed=seed, days=days)


def generate_synthetic_rainfall(*, seed: int, days: int, start: datetime | None = None) -> list[RainfallRecord]:
    """Generate deterministic rainfall for tests and offline development.

    The values are deliberately synthetic; they are not calibration data.
    """

    if days <= 0:
        raise ValueError("days must be positive")

    rng = random.Random(seed)
    start_time = start or datetime(2026, 1, 1, tzinfo=timezone.utc)
    records: list[RainfallRecord] = []

    for offset in range(days):
        seasonal_wave = 0.5 + 0.5 * math.sin(offset / 4.0)
        storm = rng.random() < 0.28
        drizzle = rng.random() * 4.0
        rainfall = drizzle + (rng.random() * 38.0 * seasonal_wave if storm else 0.0)
        records.append(
            RainfallRecord(
                timestamp=start_time + timedelta(days=offset),
                rainfall_mm=round(rainfall, 3),
                station_id="synthetic-development",
            )
        )

    return records


def _first_present(headers: Iterable[str], candidates: Iterable[str], role: str) -> str:
    key = _first_present_optional(headers, candidates)
    if key is None:
        raise ValueError(
            f"Could not identify {role} column. Pass it explicitly after verifying the local export schema."
        )
    return key


def _first_present_optional(headers: Iterable[str], candidates: Iterable[str]) -> str | None:
    normalized = {header.lower().strip(): header for header in headers}
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    return None


def _parse_datetime(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _parse_non_negative_float(value: str, column: str) -> float:
    parsed = float(value)
    if parsed < 0:
        raise ValueError(f"{column} cannot be negative")
    return parsed

