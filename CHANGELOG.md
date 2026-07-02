# Changelog

## 2026-07-01 — Stage: honest validation scaffold

- Added a Python validation scaffold aligned with `docs/MODEL_CARD.md §7-§8` for presence-only, biased, incomplete landslide labels.
- Implemented temporal train/test splitting with an explicit leakage warning and no random split helper.
- Added rainfall-event backtesting windows and required metrics: precision/recall, PR-AUC, Brier score, calibration curve, lead time, false-alarm rate, missed-event rate, per-alert-threshold evaluation, and uncertainty coverage.
- Omitted naive accuracy by design because unlabeled windows are not verified true negatives.
- Added mandatory comparison against the Tier 0 A25 baseline; beating A25 is recorded as the minimum bar for any performance claim.
- Added a reproducible `notebooks/validation.ipynb` workflow backed by the Stage 5 synthetic rainfall loader until verified SIMMA/IDEA-SIMAC data are wired in.
- Added unit tests for temporal splitting, event backtesting, metric coverage, no-accuracy reporting, and A25 comparison.

## 2026-07-01 — Stage: physical site saturation persistence

- Added shared physical `site_state` persistence keyed only by `site_id`, reflecting hillslope state rather than user-specific state.
- Added Supabase RLS for `site_state`: authenticated users can read physical site state, while inserts/updates are reserved for the service role simulation process.
- Added SQLite parity for local development with the same `site_id` uniqueness semantics.
- Changed configured site identity from chat-scoped IDs to deterministic coordinate-scoped IDs so multiple users observing the same configured point share the same physical state.
- Risk analysis now starts from the persisted `S_estimate` when present and stores the latest saturation estimate after simulation.
- When no persisted state or verified ~25-day rainfall warm-up is available, the application uses `S0 = 0.2` as an uncalibrated low cold-start with a `TODO(verify)` replacement path. This cold-start intentionally underestimates risk by design until warm-up from verified IDEA/SIMAC rainfall is wired in.
- Added an integration-style use-case test proving two consecutive analyses for the same physical site chain saturation state.

## 2026-07-01 — Stage: verified data loaders and A25 baseline

- Added Python rainfall loaders for local IDEA/SIMAC-style CSV exports, with a reproducible synthetic generator for tests and development when no verified export is present.
- Added a defensive SIMMA inventory loader for local CSV and GeoJSON exports from the documented ArcGIS Hub / datos.gov.co access path, without hardcoding an unverified dataset ID.
- Added a guarded Google Earth Engine terrain loader for Copernicus DEM GLO-30 covariates, with explicit TODO markers for unconfirmed ESA WorldCover, SoilGrids, lithology, and derived terrain fields.
- Added the Tier 0 A25 feature calculation with the documented 25-day accumulation window and 200/300/400 mm operational thresholds.
- Added synthetic-data tests for rainfall loading, SIMMA parsing, terrain guard behavior, and A25 classification.

## 2026-07-01 — Stage: EcoAgent -> ALLO visible rename

- Renamed the visible product identity from EcoAgent to **ALLO** across README, public docs, bot copy, web metadata, and user-facing i18n strings.
- Added local copies of `docs/MODEL_CARD.md` and `docs/DATA_SOURCES.md` from the repository's GitHub state so the workspace matches the current scientific framing.
- Renamed `docs/ecoagent-pruning-audit.md` to `docs/allo-brand-audit.md` and updated references.
- Renamed the visible logo asset from `web/public/logo-ecoagent.jpeg` to `web/public/logo-allo.jpeg`.
- Updated package metadata names to `allo` and `allo-web`.
- Rewrote the README around ALLO as an adaptive observatory and decision-support tool, explicitly avoiding deterministic or single-event prediction claims.
- Preserved internal contracts and prohibited identifiers, including simulation interfaces, engine names, schemas, endpoints, environment variables, `CIR_` prefixes, and SQL table names.

### Validation

- `npm install`
- `npm test`
- `npm run build`
- `cd web && npm install`
- `cd web && npm run build`

### Result

- Backend tests: passed
- Root TypeScript build: passed
- Web Next.js production build: passed

## 2026-07-01 — Stage: site extensibility seam

- Added a minimal `Site` domain model with optional terrain covariates for observatory-style extensibility.
- Documented each covariate against the verified terrain sources in `docs/DATA_SOURCES.md §C`.
- Extended the simulation input contract with optional `site_id` and `site` fields without replacing the existing Zod schema.
- Preserved backward compatibility in the local and Python simulation engine adapters.
- Added a stub site resolver with `TODO(verify)` markers pointing only to verified external sources.
- Threaded a basic configured site through the risk-analysis use case using the already persisted user coordinates, without inventing terrain covariate values.
- Added compatibility tests covering the extended simulation input shape.

## 2026-07-01 — Stage: official Jacobi rainfall-forced hazard model

- Replaced the legacy mean-reversion saturation physics with the official rainfall-forced Jacobi SDE from `docs/MODEL_CARD.md §4`, while preserving public class and contract names.
- Extended the simulation input with `S0`, `rain_series`, `dt_hours`, and `seed`, keeping backward compatibility for legacy callers.
- Implemented hazard integration `h(S, X) = h0(X) * exp(beta * (S - Sc(X))_+)` and path failure probability accumulation.
- Added seeded deterministic Monte Carlo logic and legacy-compatible rainfall-series shims so rainfall always enters as a temporal forcing.
- Extended the output with `prob_failure`, `S_mean`, `S_std`, `S_q_high`, `hazard_probability_mean`, and `model_version`, while preserving legacy aliases.
- Anchored alert mapping comments and helper logic to the A25 thresholds documented in `MODEL_CARD.md §4`.
- Added tests for reproducibility, rain-series sensitivity, `S0` sensitivity, bounded saturation summaries, legacy compatibility, and the anchored alert bands.
