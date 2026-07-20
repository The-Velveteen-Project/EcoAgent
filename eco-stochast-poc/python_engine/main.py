# ---
# 📚 WHY: Rewrite the Python engine with typed models, healthcheck, and logging.
#    The previous version didn't have /health (Docker couldn't verify readiness),
#    didn't log execution times, and used Spanish responses ("BAJO", "CRÍTICO")
#    that didn't match the Zod schema on the TypeScript side. Now it uses AlertLevel enum
#    consistent with the contract defined in ISimulationEngine.ts.
# 📁 FILE: eco-stochast-poc/python_engine/main.py
# ---

import logging
import time

import numpy as np
import uvicorn
from fastapi import FastAPI

from config import settings
from models import AlertLevel, CIRSimulationInput, CIRSimulationOutput

logging.basicConfig(level=getattr(logging, settings.log_level))
log = logging.getLogger("cir_engine")

app = FastAPI(
    title="ALLO CIR Simulation Engine",
    description="Jacobi rainfall-forced stochastic model for landslide risk assessment",
    version="2.0.0",
)


@app.get("/health")
async def health():
    """Health check endpoint required by docker-compose healthcheck."""
    return {
        "status": "ok",
        "model": "Jacobi-rainfall-forced-hazard",
        "version": "2.0.0",
    }


@app.post("/simulate_risk", response_model=CIRSimulationOutput)
async def simulate_risk(data: CIRSimulationInput) -> CIRSimulationOutput:
    start_time = time.time()
    rain_series = (
        np.array(data.rain_series, dtype=float)
        if data.rain_series
        else build_legacy_flat_rain_series(data.precipitation_mm, data.time_horizon_hours, data.dt_hours or 1.0)
    )
    dt_hours = data.dt_hours or (data.time_horizon_hours / len(rain_series))
    dt_days = dt_hours / 24.0
    sqrt_dt = np.sqrt(dt_days)
    s0 = data.S0 if data.S0 is not None else 0.5

    terrain = derive_terrain_params(data)
    n_sims = data.n_simulations
    saturation = np.full(n_sims, s0, dtype=float)
    peak_saturation = np.full(n_sims, s0, dtype=float)
    hazard_integrals = np.zeros(n_sims, dtype=float)

    rng = DeterministicNormalGenerator(data.seed or 1)

    for rainfall in rain_series:
        rho = 1.0 - np.exp(-((rainfall / max(dt_hours, 1e-9)) / 12.0))
        normals = rng.next_normals(n_sims)

        drift = (terrain["kappa"] * rho * (1.0 - saturation) - terrain["lambda"] * saturation) * dt_days
        diffusion = (
            terrain["sigma"]
            * np.sqrt(np.maximum(saturation * (1.0 - saturation), 0.0))
            * sqrt_dt
            * normals
        )
        saturation = numeric_safeguard_unit_interval(saturation + drift + diffusion)
        peak_saturation = np.maximum(peak_saturation, saturation)

        hazard = terrain["h0"] * np.exp(
            terrain["beta"] * np.maximum(saturation - terrain["critical_saturation"], 0.0)
        )
        hazard_integrals = hazard_integrals + hazard * dt_days

    prob_failure = float(np.mean(peak_saturation > terrain["critical_saturation"]))
    path_failure_probability = 1.0 - np.exp(-hazard_integrals)
    s_mean = float(np.mean(peak_saturation))
    s_std = float(np.std(peak_saturation))
    s_q_high = float(np.quantile(peak_saturation, 0.95))
    hazard_probability_mean = float(np.mean(path_failure_probability))
    alert = map_alert_level(prob_failure)

    elapsed_ms = (time.time() - start_time) * 1000
    log.info(
        f"Simulation complete: {n_sims} paths, {elapsed_ms:.1f}ms, "
        f"prob_failure={prob_failure:.3f}, alert={alert.value}, total_rain={float(np.sum(rain_series)):.1f}mm"
    )

    return CIRSimulationOutput(
        prob_failure=round(prob_failure, 4),
        S_mean=round(s_mean, 4),
        S_std=round(s_std, 4),
        S_q_high=round(s_q_high, 4),
        hazard_probability_mean=round(hazard_probability_mean, 4),
        model_version="jacobi_rainfall_forced_v2",
        risk_probability=round(prob_failure, 4),
        mean_saturation=round(s_mean, 4),
        std_saturation=round(s_std, 4),
        alert_level=alert,
    )


def build_legacy_flat_rain_series(precipitation_mm: float, time_horizon_hours: float, dt_hours: float) -> np.ndarray:
    steps = max(1, round(time_horizon_hours / max(dt_hours, 1e-9)))
    return np.full(steps, precipitation_mm / steps, dtype=float)


def derive_terrain_params(data: CIRSimulationInput) -> dict[str, float]:
    covariates = (data.site or {}).get("covariates", {}) if data.site else {}
    slope = covariates.get("slope")
    twi = covariates.get("twi")
    lithology = str(covariates.get("lithology", "")).lower() or None
    soil = str(covariates.get("soil", "")).lower() or None

    kappa = 0.32
    if soil and ("andosol" in soil or "volcan" in soil):
        kappa += 0.05
    if lithology and "volcan" in lithology:
        kappa += 0.03

    lam = 0.10
    if isinstance(slope, (int, float)):
        lam += min(max(float(slope) / 200.0, 0.0), 0.12)
    if isinstance(twi, (int, float)):
        lam += min(max(float(twi) / 100.0, 0.0), 0.08)
    lam += max(data.temperature_c, 0.0) / 400.0

    critical_saturation = 0.78
    if isinstance(slope, (int, float)):
        critical_saturation -= min(max(float(slope) / 300.0, 0.0), 0.12)
    if lithology and ("weak" in lithology or "ash" in lithology):
        critical_saturation -= 0.05

    return {
        "kappa": kappa,
        "lambda": lam,
        "sigma": 0.12,
        "h0": 0.015,
        "beta": 9.0,
        "critical_saturation": min(max(critical_saturation, 0.55), 0.9),
    }


def numeric_safeguard_unit_interval(values: np.ndarray) -> np.ndarray:
    # Numeric safeguard only: absorbs floating-point / discretization leakage at the boundaries.
    return np.clip(values, 0.0, 1.0)


def map_alert_level(prob_failure: float) -> AlertLevel:
    # Anchored to MODEL_CARD.md §4 A25 thresholds:
    # 200 mm -> LOW/MEDIUM, 300 mm -> MEDIUM/HIGH, 400 mm -> HIGH/CRITICAL.
    if prob_failure >= 0.7:
        return AlertLevel.CRITICAL
    if prob_failure >= 0.4:
        return AlertLevel.HIGH
    if prob_failure >= 0.15:
        return AlertLevel.MEDIUM
    return AlertLevel.LOW


class DeterministicNormalGenerator:
    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    def next_uniform(self) -> float:
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 4294967296.0

    def next_normal(self) -> float:
        u1 = 0.0
        u2 = 0.0
        while u1 <= 0.0:
            u1 = self.next_uniform()
        while u2 <= 0.0:
            u2 = self.next_uniform()
        return float(np.sqrt(-2.0 * np.log(u1)) * np.cos(2.0 * np.pi * u2))

    def next_normals(self, count: int) -> np.ndarray:
        return np.array([self.next_normal() for _ in range(count)], dtype=float)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
