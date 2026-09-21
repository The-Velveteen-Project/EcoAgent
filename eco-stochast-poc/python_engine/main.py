# ---
# ALLO simulation engine — rainfall-forced Jacobi (Wright-Fisher) saturation SDE + hazard link.
# Scientific ground truth: docs/MODEL_CARD.md §3-§4 and the invariants in §9.
#
# This is the refactor described in the ALLO diagnostic. Changes vs. the previous version:
#   1. RNG: numpy Generator(PCG64) replaces the hand-rolled LCG + Box-Muller
#      (invariant #4 reproducibility, without LCG low-bit serial correlation).
#   2. Probability: ONE definition of failure probability. `prob_failure` IS the hazard-link
#      path probability  P = 1 - exp(-∫h ds)  (MODEL_CARD §4, invariant #6). The old
#      "fraction of paths whose peak S exceeds Sc" is kept ONLY as the auxiliary diagnostic
#      `exceedance_fraction`, never as "the probability".
#   3. Terrain params come from calibrated config (config.ModelParams), adjusted by covariates
#      through documented monotone rules — no magic numbers inside the hot loop (invariant #5).
#   4. Discretization: a single declared time step (dt in days) with a domain-preserving
#      Euler-Maruyama step; Feller boundary conditions are computed and RETURNED, not ignored.
#
# ARCHIVO: eco-stochast-poc/python_engine/main.py
# ---

import logging
import time

import numpy as np
import uvicorn
from fastapi import FastAPI
from numpy.random import default_rng

from config import model_params, settings
from models import AlertLevel, SimulationInput, SimulationOutput

logging.basicConfig(level=getattr(logging, settings.log_level))
log = logging.getLogger("allo_engine")

MODEL_VERSION = "jacobi_rainfall_forced_v3"

app = FastAPI(
    title="ALLO Simulation Engine",
    description="Rainfall-forced Jacobi (Wright-Fisher) saturation SDE with hazard link (MODEL_CARD.md §4)",
    version="3.0.0",
)


@app.get("/health")
async def health():
    """Health check endpoint required by docker-compose healthcheck."""
    return {"status": "ok", "model": "Jacobi-rainfall-forced-hazard", "version": "3.0.0"}


# --------------------------------------------------------------------------------------
# Physics helpers
# --------------------------------------------------------------------------------------
def rho_of_rain(rain_mm_per_day: np.ndarray | float, rain_half_mm: float) -> np.ndarray | float:
    """Saturating wetting response to rainfall intensity (dimensionless, in [0,1)).

    Michaelis-Menten form rho(R) = R / (R + R_half). Monotone increasing in R and bounded,
    so the wetting flux kappa*rho*(1-S) stays finite — MODEL_CARD §4 'saturating function
    of rainfall intensity'.
    """
    r = np.asarray(rain_mm_per_day, dtype=float)
    return r / (r + rain_half_mm)


def resolve_terrain_params(data: SimulationInput) -> dict[str, float]:
    """Start from calibrated config defaults and adjust by covariates via monotone rules.

    Rules follow the documented physical direction (MODEL_CARD §4): permeable andosols raise
    infiltration kappa; steeper/wetter and warmer sites drain faster (lambda up); steeper or
    weaker terrain lowers critical saturation Sc. Magnitudes are declared config, not literals
    scattered in the integration loop.
    """
    p = model_params
    covariates = (data.site or {}).get("covariates", {}) if data.site else {}
    slope = covariates.get("slope")
    twi = covariates.get("twi")
    lithology = (str(covariates.get("lithology", "")).lower() or None)
    soil = (str(covariates.get("soil", "")).lower() or None)

    kappa = p.kappa
    if soil and ("andosol" in soil or "volcan" in soil):
        kappa += 0.05
    if lithology and "volcan" in lithology:
        kappa += 0.03

    lam = p.lam
    if isinstance(slope, (int, float)):
        lam += min(max(float(slope) / 200.0, 0.0), 0.12)
    if isinstance(twi, (int, float)):
        lam += min(max(float(twi) / 100.0, 0.0), 0.08)
    lam += max(data.temperature_c, 0.0) / 400.0

    sc = p.critical_saturation
    if isinstance(slope, (int, float)):
        sc -= min(max(float(slope) / 300.0, 0.0), 0.12)
    if lithology and ("weak" in lithology or "ash" in lithology):
        sc -= 0.05

    return {
        "kappa": kappa,
        "lambda": lam,
        "sigma": p.sigma,
        "rain_half_mm": p.rain_half_mm,
        "h0": p.h0,
        "beta": p.beta,
        "critical_saturation": float(min(max(sc, 0.55), 0.9)),
    }


def feller_conditions(params: dict[str, float], mean_rho: float) -> dict[str, bool]:
    """Boundary non-attainment (Feller-type) checks — MODEL_CARD §4.

    Near S=0 the drift must dominate diffusion: kappa*rho >= sigma^2/2.
    Near S=1 drainage must dominate:              lambda    >= sigma^2/2.
    Returned to the caller so violations are documented, never silently clamped away.
    """
    half_var = params["sigma"] ** 2 / 2.0
    return {
        "feller_low_ok": params["kappa"] * mean_rho >= half_var,
        "feller_high_ok": params["lambda"] >= half_var,
    }


def build_flat_rain_series(precipitation_mm: float, n_steps: int) -> np.ndarray:
    """Spread a scalar accumulated total evenly across the horizon (compat path).

    Used only when a caller supplies a single accumulated `precipitation_mm` instead of a
    temporal `rain_series`. Rainfall still enters as forcing (invariant #1), just uniform.
    """
    n = max(1, int(n_steps))
    return np.full(n, precipitation_mm / n, dtype=float)


def map_alert_level(prob_failure: float) -> AlertLevel:
    """Map the hazard-link failure probability over the alert window to alert bands.

    NOTE: these cut points are provisional and MUST be recalibrated against the A25 anchors
    (200/300/400 mm -> yellow/orange/red, MODEL_CARD §4) and the event backtest before any
    operational or published use (invariant #5). They are not asserted as correct here.
    """
    if prob_failure >= 0.70:
        return AlertLevel.CRITICAL
    if prob_failure >= 0.40:
        return AlertLevel.HIGH
    if prob_failure >= 0.15:
        return AlertLevel.MEDIUM
    return AlertLevel.LOW


# --------------------------------------------------------------------------------------
# Core simulation
# --------------------------------------------------------------------------------------
def simulate(
    rain_series: np.ndarray,
    *,
    dt_days: float,
    s0: float,
    n_sims: int,
    params: dict[str, float],
    seed: int,
    alert_window_days: float | None = None,
) -> dict:
    """Vectorized Euler-Maruyama integration of the Jacobi SDE + hazard accumulation.

    `rain_series` holds rainfall DEPTH per bin (mm accumulated in one bin of length dt_days).
    Returns the full result bundle (probabilities, saturation summaries, Feller flags).
    """
    rng = default_rng(seed)
    sqrt_dt = np.sqrt(dt_days)
    S = np.full(n_sims, s0, dtype=float)
    peak = S.copy()
    hazard_integral = np.zeros(n_sims, dtype=float)

    # rho takes an INTENSITY in mm/day, because rain_half_mm is a half-saturation in mm/day and
    # that is the unit the hazard link was calibrated in (daily rainfall, dt = 1 day). Bins are
    # depths, so convert: depth / dt_days. For daily bins this is the identity. Without it the
    # wetting response depends on the bin size: the same 120 mm in 24 h gave a peak S of 0.63
    # as 24 hourly bins and 0.83 as one daily bin.
    rain_intensity_mm_per_day = np.asarray(rain_series, dtype=float) / dt_days
    rho_series = rho_of_rain(rain_intensity_mm_per_day, params["rain_half_mm"])
    for rho in rho_series:
        drift = (params["kappa"] * rho * (1.0 - S) - params["lambda"] * S) * dt_days
        diffusion = params["sigma"] * np.sqrt(np.maximum(S * (1.0 - S), 0.0)) * sqrt_dt * rng.standard_normal(n_sims)
        # Domain-preserving step: clip absorbs only Euler discretization leakage at the
        # boundaries; the Jacobi diffusion vanishing at 0 and 1 is the physical mechanism
        # keeping S in [0,1] (invariant #3).
        S = np.clip(S + drift + diffusion, 0.0, 1.0)
        peak = np.maximum(peak, S)
        hazard = params["h0"] * np.exp(params["beta"] * np.maximum(S - params["critical_saturation"], 0.0))
        hazard_integral += hazard * dt_days

    # THE probability (invariant #6): hazard-link survival complement, per path, then averaged.
    #
    # It is stated over an explicit window. The alert cut points (0.15 / 0.40 / 0.70) are a
    # decision policy on the probability integrated over the A25 window of 25 days: that is the
    # quantity the calibration's rainfall-trigger table was computed on. A caller asking for a
    # 24 h horizon integrates 25 times less hazard, and fed through the same cut points that
    # number cannot leave LOW (with S = 1 for the whole day it reaches 0.10). So the simulated
    # hazard is carried to the policy window under a declared persistence assumption: the mean
    # hazard rate over the simulated horizon holds for the rest of the window. The probability
    # over the simulated horizon itself is still returned, labelled, as an auxiliary field.
    horizon_days = dt_days * len(rho_series)
    window_days = alert_window_days if alert_window_days is not None else horizon_days
    path_failure_prob_horizon = 1.0 - np.exp(-hazard_integral)
    path_failure_prob = 1.0 - np.exp(-hazard_integral * (window_days / horizon_days))
    prob_failure = float(np.mean(path_failure_prob))
    # Auxiliary diagnostic only — explicitly NOT "the probability".
    exceedance_fraction = float(np.mean(peak > params["critical_saturation"]))

    feller = feller_conditions(params, float(np.mean(rho_series)))
    return {
        "prob_failure": prob_failure,
        "prob_failure_q05": float(np.quantile(path_failure_prob, 0.05)),
        "prob_failure_q95": float(np.quantile(path_failure_prob, 0.95)),
        "prob_failure_horizon": float(np.mean(path_failure_prob_horizon)),
        "horizon_days": float(horizon_days),
        "alert_window_days": float(window_days),
        "exceedance_fraction": exceedance_fraction,
        "S_mean": float(np.mean(peak)),
        "S_std": float(np.std(peak)),
        "S_q_high": float(np.quantile(peak, 0.95)),
        **feller,
    }


@app.post("/simulate_risk", response_model=SimulationOutput)
async def simulate_risk(data: SimulationInput) -> SimulationOutput:
    start_time = time.time()

    # Resolve the rainfall forcing and a SINGLE declared time step (in days).
    if data.rain_series:
        rain_series = np.asarray(data.rain_series, dtype=float)
        dt_hours = data.dt_hours if data.dt_hours is not None else (data.time_horizon_hours / len(rain_series))
    else:
        n_steps = max(1, round(data.time_horizon_hours / (data.dt_hours or 24.0)))
        rain_series = build_flat_rain_series(data.precipitation_mm, n_steps)
        dt_hours = data.dt_hours if data.dt_hours is not None else (data.time_horizon_hours / n_steps)
    dt_days = dt_hours / 24.0

    s0 = data.S0 if data.S0 is not None else settings.default_S0
    n_sims = data.n_simulations
    params = resolve_terrain_params(data)

    r = simulate(
        rain_series, dt_days=dt_days, s0=s0, n_sims=n_sims, params=params, seed=(data.seed or 1),
        alert_window_days=model_params.alert_horizon_days,
    )
    alert = map_alert_level(r["prob_failure"])

    if not (r["feller_low_ok"] and r["feller_high_ok"]):
        log.warning(
            "Feller boundary condition violated (low_ok=%s high_ok=%s) — S may attain a boundary; "
            "document per MODEL_CARD §4.", r["feller_low_ok"], r["feller_high_ok"],
        )

    elapsed_ms = (time.time() - start_time) * 1000
    log.info(
        "Simulation complete: %d paths, %.1fms, prob_failure=%.3f, alert=%s, total_rain=%.1fmm",
        n_sims, elapsed_ms, r["prob_failure"], alert.value, float(np.sum(rain_series)),
    )

    return SimulationOutput(
        prob_failure=round(r["prob_failure"], 4),
        prob_failure_q05=round(r["prob_failure_q05"], 4),
        prob_failure_q95=round(r["prob_failure_q95"], 4),
        prob_failure_horizon=round(r["prob_failure_horizon"], 4),
        horizon_days=round(r["horizon_days"], 4),
        alert_window_days=r["alert_window_days"],
        exceedance_fraction=round(r["exceedance_fraction"], 4),
        S_mean=round(r["S_mean"], 4),
        S_std=round(r["S_std"], 4),
        S_q_high=round(r["S_q_high"], 4),
        feller_low_ok=r["feller_low_ok"],
        feller_high_ok=r["feller_high_ok"],
        model_version=MODEL_VERSION,
        alert_level=alert,
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
