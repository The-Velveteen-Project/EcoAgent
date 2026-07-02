"""SIMMA landslide inventory loader.

docs/DATA_SOURCES.md §B documents SIMMA access through ArcGIS Hub
(`datos.sgc.gov.co`) and `datos.gov.co`, with REST / GeoJSON / SHP / CSV export
options. It does not confirm a dataset ID or exact column schema, so this module
loads provided exports and parses defensively.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class LandslideEvent:
    event_id: str | None
    occurred_on: date | None
    lat: float | None
    lon: float | None
    movement_type: str | None
    source: str = "SIMMA"
    raw: dict[str, Any] | None = None


ID_COLUMNS = ("id", "event_id", "objectid", "OBJECTID")
DATE_COLUMNS = ("date", "event_date", "fecha", "fecha_evento", "fecha_ocurrencia")
LAT_COLUMNS = ("lat", "latitude", "y", "LATITUD", "latitud")
LON_COLUMNS = ("lon", "longitude", "x", "LONGITUD", "longitud")
TYPE_COLUMNS = ("type", "movement_type", "tipo", "tipo_movimiento", "clase")


def load_simma_inventory(path: str | Path) -> list[LandslideEvent]:
    """Load a SIMMA export in CSV or GeoJSON format.

    TODO(verify): confirm the authoritative SIMMA dataset identifier and column
    schema from the ArcGIS Hub / datos.gov.co record before using parsed fields
    for calibration.
    """

    inventory_path = Path(path)
    suffix = inventory_path.suffix.lower()
    if suffix == ".csv":
        return load_simma_csv(inventory_path)
    if suffix in (".geojson", ".json"):
        return load_simma_geojson(inventory_path)
    raise ValueError(
        "Unsupported inventory export. Use CSV or GeoJSON exported from SIMMA as documented in DATA_SOURCES.md §B."
    )


def load_simma_csv(path: str | Path) -> list[LandslideEvent]:
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"Inventory CSV has no header: {path}")
        headers = tuple(reader.fieldnames)
        return [_event_from_row(row, headers) for row in reader]


def load_simma_geojson(path: str | Path) -> list[LandslideEvent]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    features = payload.get("features")
    if not isinstance(features, list):
        raise ValueError("GeoJSON inventory must contain a features array")

    events: list[LandslideEvent] = []
    for feature in features:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        lon = coordinates[0] if len(coordinates) >= 1 else None
        lat = coordinates[1] if len(coordinates) >= 2 else None
        headers = tuple(str(key) for key in properties.keys())
        event = _event_from_row(properties, headers)
        events.append(
            LandslideEvent(
                event_id=event.event_id,
                occurred_on=event.occurred_on,
                lat=_optional_float(lat) if lat is not None else event.lat,
                lon=_optional_float(lon) if lon is not None else event.lon,
                movement_type=event.movement_type,
                raw=properties,
            )
        )
    return events


def _event_from_row(row: dict[str, Any], headers: Iterable[str]) -> LandslideEvent:
    # TODO(verify): candidate names reflect common export conventions, not a confirmed SIMMA schema.
    event_id_key = _first_present_optional(headers, ID_COLUMNS)
    date_key = _first_present_optional(headers, DATE_COLUMNS)
    lat_key = _first_present_optional(headers, LAT_COLUMNS)
    lon_key = _first_present_optional(headers, LON_COLUMNS)
    type_key = _first_present_optional(headers, TYPE_COLUMNS)

    return LandslideEvent(
        event_id=_optional_text(row.get(event_id_key)) if event_id_key else None,
        occurred_on=_optional_date(row.get(date_key)) if date_key else None,
        lat=_optional_float(row.get(lat_key)) if lat_key else None,
        lon=_optional_float(row.get(lon_key)) if lon_key else None,
        movement_type=_optional_text(row.get(type_key)) if type_key else None,
        raw=dict(row),
    )


def _first_present_optional(headers: Iterable[str], candidates: Iterable[str]) -> str | None:
    exact = {header: header for header in headers}
    normalized = {header.lower().strip(): header for header in headers}
    for candidate in candidates:
        if candidate in exact:
            return exact[candidate]
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    return None


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _optional_date(value: Any) -> date | None:
    text = _optional_text(value)
    if text is None:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return datetime.strptime(text, "%Y-%m-%d").date()

