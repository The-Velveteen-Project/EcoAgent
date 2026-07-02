from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from features.a25 import classify_a25, compute_a25
from loaders.inventory import load_simma_csv, load_simma_geojson
from loaders.rainfall import generate_synthetic_rainfall, load_rainfall_csv
from loaders.terrain import TerrainLoaderNotConfigured, load_terrain_covariates


class DataLoaderTests(unittest.TestCase):
    def test_synthetic_rainfall_is_reproducible(self) -> None:
        first = generate_synthetic_rainfall(seed=42, days=5)
        second = generate_synthetic_rainfall(seed=42, days=5)
        different = generate_synthetic_rainfall(seed=43, days=5)

        self.assertEqual(first, second)
        self.assertNotEqual([record.rainfall_mm for record in first], [record.rainfall_mm for record in different])

    def test_rainfall_csv_loader_detects_columns(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "rain.csv"
            path.write_text(
                "fecha,precipitacion_mm,estacion\n"
                "2026-01-01,3.5,S1\n"
                "2026-01-02,0.0,S1\n",
                encoding="utf-8",
            )

            records = load_rainfall_csv(path)

        self.assertEqual(len(records), 2)
        self.assertEqual(records[0].rainfall_mm, 3.5)
        self.assertEqual(records[0].station_id, "S1")

    def test_inventory_csv_loader_parses_defensively(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "simma.csv"
            path.write_text(
                "OBJECTID,fecha,latitud,longitud,tipo_movimiento\n"
                "10,2024-02-03,5.07,-75.51,deslizamiento\n",
                encoding="utf-8",
            )

            events = load_simma_csv(path)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_id, "10")
        self.assertEqual(events[0].occurred_on.isoformat(), "2024-02-03")
        self.assertAlmostEqual(events[0].lat or 0.0, 5.07)
        self.assertEqual(events[0].movement_type, "deslizamiento")

    def test_inventory_geojson_loader_prefers_geometry_coordinates(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "simma.geojson"
            path.write_text(
                '{"type":"FeatureCollection","features":[{"type":"Feature",'
                '"properties":{"id":"evt-1","date":"2024-02-03"},'
                '"geometry":{"type":"Point","coordinates":[-75.51,5.07]}}]}',
                encoding="utf-8",
            )

            events = load_simma_geojson(path)

        self.assertEqual(events[0].event_id, "evt-1")
        self.assertAlmostEqual(events[0].lat or 0.0, 5.07)
        self.assertAlmostEqual(events[0].lon or 0.0, -75.51)

    def test_terrain_loader_has_clear_guard_and_example_mode(self) -> None:
        example = load_terrain_covariates(5.0703, -75.5138, allow_example=True)
        self.assertFalse(example.verified)
        self.assertIn("example-only", example.source)

        try:
            load_terrain_covariates(5.0703, -75.5138, allow_example=False)
        except TerrainLoaderNotConfigured as exc:
            self.assertIn("Google Earth Engine", str(exc))

    def test_a25_accumulation_and_classification(self) -> None:
        records = [
            type(
                "Rain",
                (),
                {"timestamp": datetime(2026, 1, day, tzinfo=timezone.utc), "rainfall_mm": 10.0},
            )
            for day in range(1, 27)
        ]

        result = compute_a25(records)

        self.assertEqual(result[-1].a25_mm, 250.0)
        self.assertEqual(result[-1].alert, "MEDIUM")
        self.assertEqual(classify_a25(199.99), "LOW")
        self.assertEqual(classify_a25(200.0), "MEDIUM")
        self.assertEqual(classify_a25(300.0), "HIGH")
        self.assertEqual(classify_a25(400.0), "CRITICAL")


if __name__ == "__main__":
    unittest.main()
