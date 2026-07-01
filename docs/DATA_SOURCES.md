# ALLO — Data Sources

Verified data catalog for ALLO. Every source below was checked for real access. Honesty flags mark what
could not be confirmed. **Implementers MUST NOT invent sources or endpoints.** To add a source, verify
access first and record it here with the same fields.

Integration note: most raster layers (Copernicus DEM, ESA WorldCover, SoilGrids, CHIRPS, ERA5-Land,
GPM IMERG) are available in **Google Earth Engine (GEE)** — a single API for the whole raster stack.
This is the recommended primary integration path for terrain and satellite layers.

Legend for **Role**: `train` = model calibration/training · `val` = validation/labels ·
`covariate` = model input · `context` = regional/meso-scale · `deploy` = real-time serving.

---

## A. Rainfall & hydrometeorology

| Source | Variables | Resolution | Coverage | Access | Role | Flags |
|---|---|---|---|---|---|---|
| **IDEA-UNAL / SIMAC network** | Rain, temp, humidity, ET, stream level | **5 min**, ~25 met + ~35 hydromet stations | Manizales + Caldas | Public geoportal `cdiac.manizales.unal.edu.co/geoportal-simac`; some stations on Wunderground | train, covariate, deploy | **No documented public API.** JS app; likely needs scraping or institutional request. **Carlos has UNAL institutional access — pursue that.** The single most valuable local source. |
| **A25 index (IDEA)** | 25-day accumulated rainfall; operational alert indicator | Daily, per station | Manizales | IDEA bulletins / SIMAC reports | train, val (anchor) | Operational thresholds 200/300/400 mm → yellow/orange/red. Reference baseline (Tier 0). |
| **IDEAM — DHIME** | National rainfall/hydromet time series | Daily/hourly | Colombia | Portal `dhime.ideam.gov.co`; CSV/Excel export | context, covariate | Research use permitted; 3 approval levels (preliminary / in-revision / definitive). |
| **CHIRPS** | Rainfall (satellite + station blend) | 0.05° (~5.5 km), daily, since 1981 | Quasi-global 50°N–50°S | GEE; UCSB Climate Hazards Group FTP | context, regional extension | Coarser than individual Manizales hillslopes. |
| **ERA5-Land** | Reanalysis: rainfall, temp, humidity, soil moisture | ~9 km (0.1°), hourly, since 1950 | Global | GEE; Copernicus CDS | covariate, context | Its soil-moisture band is a *weak* proxy for `S_t`, not ground truth. |
| **GPM IMERG** | Rainfall (satellite) | 0.1° (~11 km), 30 min, since 2000 | 60°N–S | GEE; NASA | context, nowcasting (regional) | Coarse for the local case. |
| **NASA POWER** | Daily meteorology | ~0.5°, daily | Global | REST API | fallback | Very coarse; last-resort forcing. |
| **Open-Meteo** (currently in EcoAgent) | Forecast/current weather | Point API | Global | Public API | deploy (current) | Convenience API; not authoritative for calibration. |

---

## B. Landslide inventory (labels — required for calibration & validation)

| Source | Content | Coverage | Access | Role | Flags |
|---|---|---|---|---|---|
| **SIMMA (SGC)** | Field-verified mass-movement events: type, date, geolocation | National | **Open data** via ArcGIS Hub `datos.sgc.gov.co` and `datos.gov.co` → REST / GeoJSON / SHP / CSV | train, val | **Reporting bias** (near roads/urban); irregular completeness. Primary label source. |
| **DesInventar** | Historical disaster records incl. "deslizamiento" | Colombia, municipal | `desinventar.org` (UNDRR) | context, weak val | ⚠️ **Exact download page not confirmed in research pass — verify.** Municipal resolution, not hillslope. Impact-biased. |
| **UNGRD** | Reported emergencies | National/municipal | UNGRD portals / `datos.gov.co` | context | Response-oriented, not geotechnical inventory. |
| **OMPAD / UGR Manizales** | Local landslide catalog since **1948** | Manizales | Institutional (not a clean public dataset) | train, val | Most valuable locally; requires institutional request. |
| **NASA GLC / COOLR** | Rainfall-triggered landslides | Global, 2007+ | Download gdb/shp/csv (Landslide Viewer) | context, weak val | Location accuracy ~km (`loc_accu`); too coarse for a single city. Cite event inventories per their `citation` field. |

**Modeling consequence:** labels are **presence-only, biased, incomplete**. Treat accordingly
(presence-only / weak-supervision methods, event-based backtesting). See `MODEL_CARD.md` §7–8.

---

## C. Geomorphology & terrain (currently absent from the model — must be added)

| Source | Variables | Resolution | Access | Role |
|---|---|---|---|---|
| **Copernicus DEM GLO-30** | Elevation (DSM) → slope, aspect, curvature, TWI, flow accumulation, distance-to-drainage | 30 m, global | GEE `COPERNICUS/DEM/GLO30`; Planetary Computer; OpenTopography | covariate |
| **ALOS PALSAR DEM** | Finer elevation | 12.5 m | ASF / JAXA | covariate (optional) |
| **ESA WorldCover** | Land cover (11 classes) | **10 m**, 2020 / 2021 | GEE | covariate |
| **SoilGrids** | Soil properties (texture, bulk density, …) | 250 m, global | GEE / ISRIC | covariate |
| **SGC geological maps** | Lithology, geomorphology, susceptibility zoning | Variable (1:100k + local studies) | `datos.sgc.gov.co` / SIMMA | covariate |
| **OpenStreetMap** | Roads, drainages, buildings | Vector | Overpass API | covariate, exposure |

Topographic derivatives (slope, TWI, curvature, flow accumulation) are computed from the DEM in GEE, or
in Python via `richdem` / `whitebox`. **No field survey required from the team.**

---

## D. Exposure & vulnerability

| Source | Variables | Resolution | Access | Role |
|---|---|---|---|---|
| **WorldPop / GHSL** | Population; built-up | 100 m / built-up layers | GEE / JRC | exposure |
| **OSM buildings & roads** | Buildings, roads | Vector | Overpass | exposure |
| **DANE / datos.gov.co** | Census blocks, municipal layers | Census block | Open portals | exposure |
| **POT Manizales** | Zoning, risk maps, neighborhoods | Municipal | Alcaldía / SIMAC | exposure, communication |

Exposure is used for **alert prioritization and communication**, not as a predictor of hazard.

---

## E. Licensing & use notes

- IDEAM DHIME: scientific/statistical research use; respect approval-level semantics.
- SIMMA / SGC open data: check dataset-level terms on the portal.
- NASA GLC/COOLR: cite the event inventories used (per-record `citation`).
- IDEA-UNAL / SIMAC: institutional data — coordinate use through UNAL Manizales.
- Copernicus DEM GLO-30 Public: open; a small set of country tiles may be restricted (not Colombia-relevant here, verify).

---

## F. Recommended v1 data stack (concretized)

- **Forcing:** IDEA-UNAL / SIMAC rainfall (local) → aggregated to daily + antecedent windows (1/3/5/15/25 d).
- **Labels:** SIMMA (open) + OMPAD/UGR local catalog (institutional) → presence events.
- **Covariates:** Copernicus DEM GLO-30 derivatives + ESA WorldCover + SoilGrids + SGC lithology (all via GEE).
- **Reference baseline:** A25 index reconstruction from rainfall.
- **Regional extension (later):** CHIRPS / ERA5-Land / IMERG + COOLR for sites without local instrumentation.
