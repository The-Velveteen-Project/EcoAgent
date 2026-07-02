"""Terrain covariate loader through Google Earth Engine.

docs/DATA_SOURCES.md §C recommends GEE for Copernicus DEM GLO-30, ESA
WorldCover, and SoilGrids. This module keeps the integration point ready while
guarding clearly when Earth Engine is not installed or authenticated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


COPERNICUS_DEM_GLO30 = "COPERNICUS/DEM/GLO30"
# TODO(verify): confirm the exact GEE collection/image IDs for ESA WorldCover and SoilGrids
# in the configured project before enabling production extraction.


@dataclass(frozen=True)
class TerrainCovariates:
    slope: float | None
    aspect: float | None
    curvature: float | None
    twi: float | None
    flow_accum: float | None
    dist_drainage: float | None
    lithology: str | None
    land_cover: str | None
    soil: str | None
    source: str
    verified: bool


class TerrainLoaderNotConfigured(RuntimeError):
    """Raised when Google Earth Engine is not available in the runtime."""


def load_terrain_covariates(lat: float, lon: float, *, allow_example: bool = False) -> TerrainCovariates:
    """Load terrain covariates for one site from GEE, or return a marked example.

    The example branch is for local development and tests only. It must not be
    treated as verified model input.
    """

    try:
        import ee  # type: ignore
    except ImportError as exc:
        if allow_example:
            return example_terrain_covariates(lat, lon)
        raise TerrainLoaderNotConfigured(
            "Google Earth Engine is not installed. Install earthengine-api and authenticate GEE before "
            "loading Copernicus DEM GLO-30 / ESA WorldCover / SoilGrids covariates from DATA_SOURCES.md §C."
        ) from exc

    try:
        ee.Initialize()
    except Exception as exc:
        if allow_example:
            return example_terrain_covariates(lat, lon)
        raise TerrainLoaderNotConfigured(
            "Google Earth Engine is not initialized/authenticated. Run the project-approved GEE auth flow "
            "before loading DATA_SOURCES.md §C covariates."
        ) from exc

    return _load_gee_covariates(ee, lat, lon)


def example_terrain_covariates(lat: float, lon: float) -> TerrainCovariates:
    """Return explicit non-verified example values for tests/development."""

    return TerrainCovariates(
        slope=15.0,
        aspect=None,
        curvature=None,
        twi=None,
        flow_accum=None,
        dist_drainage=None,
        lithology=None,
        land_cover="TODO(verify): ESA WorldCover class from GEE",
        soil="TODO(verify): SoilGrids class/properties from GEE",
        source=f"example-only:{lat:.5f},{lon:.5f}",
        verified=False,
    )


def _load_gee_covariates(ee: Any, lat: float, lon: float) -> TerrainCovariates:
    point = ee.Geometry.Point([lon, lat])
    dem = ee.ImageCollection(COPERNICUS_DEM_GLO30).select("DEM").mosaic()
    terrain = ee.Terrain.products(dem)
    sample = terrain.sample(point, 30).first().getInfo()
    properties = (sample or {}).get("properties", {})

    # TODO(verify): implement curvature, TWI, flow accumulation, distance-to-drainage,
    # ESA WorldCover, SoilGrids, and SGC lithology extraction after confirming exact
    # GEE asset IDs / derivation settings for this deployment.
    return TerrainCovariates(
        slope=_optional_float(properties.get("slope")),
        aspect=_optional_float(properties.get("aspect")),
        curvature=None,
        twi=None,
        flow_accum=None,
        dist_drainage=None,
        lithology=None,
        land_cover=None,
        soil=None,
        source=COPERNICUS_DEM_GLO30,
        verified=True,
    )


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)

