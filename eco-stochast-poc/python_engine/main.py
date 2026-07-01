# ---
# 📚 POR QUÉ: Reescribe el motor Python con modelos tipados, healthcheck, y logging.
#    La versión anterior no tenía /health (Docker no podía verificar readiness),
#    no loggeaba tiempos de ejecución, y usaba respuestas en español ("BAJO", "CRÍTICO")
#    que no matcheaban el schema Zod del lado TypeScript. Ahora usa AlertLevel enum
#    consistente con el contrato definido en ISimulationEngine.ts.
# 📁 ARCHIVO: eco-stochast-poc/python_engine/main.py
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
    description="Cox-Ingersoll-Ross stochastic model for landslide risk assessment",
    version="1.0.0",
)


@app.get("/health")
async def health():
    """Health check endpoint required by docker-compose healthcheck."""
    return {
        "status": "ok",
        "model": "CIR-Euler-Maruyama",
        "version": "1.0.0",
    }


@app.post("/simulate_risk", response_model=CIRSimulationOutput)
async def simulate_risk(data: CIRSimulationInput) -> CIRSimulationOutput:
    """
    Runs a Monte Carlo CIR simulation using the Euler-Maruyama discretization.

    The CIR SDE: dR_t = a(b - R_t)dt + σ√(R_t)dW_t

    Where:
    - R_t: soil saturation risk factor
    - a: mean reversion speed (how fast risk returns to normal)
    - b: long-term mean (baseline risk for the region, modified by weather)
    - σ: volatility (stochastic noise amplitude)
    """
    start_time = time.time()

    # ── Calibrate CIR parameters from weather data ────────────
    a = settings.cir_mean_reversion_speed
    sigma = settings.cir_volatility

    # Long-term mean 'b' is driven by precipitation and humidity
    b = settings.cir_long_term_mean
    b += data.precipitation_mm * 0.05  # Heavy rain increases baseline risk
    b += (data.humidity_pct / 100.0) * 0.2  # High humidity amplifies saturation

    # Temperature effect: higher temp → more evaporation → less saturation
    evaporation_factor = max(0, 1.0 - (data.temperature_c / 50.0) * 0.1)
    b *= evaporation_factor

    # Volatility scales with precipitation intensity
    sigma_adj = sigma * (1.0 + data.precipitation_mm / 20.0)

    # ── Euler-Maruyama Monte Carlo simulation ─────────────────
    T = data.time_horizon_hours / 24.0  # Convert hours to days
    N = 100  # Time steps
    dt = T / N
    n_sims = data.n_simulations

    # Vectorized simulation across all paths
    R = np.zeros((n_sims, N))
    R[:, 0] = 0.05  # Initial risk level

    rng = np.random.default_rng()

    for i in range(1, N):
        dW = rng.normal(0, np.sqrt(dt), size=n_sims)
        current_R = np.maximum(R[:, i - 1], 0)

        drift = a * (b - current_R) * dt
        diffusion = sigma_adj * np.sqrt(current_R) * dW

        R[:, i] = np.maximum(current_R + drift + diffusion, 0)

    # ── Compute statistics ────────────────────────────────────
    max_saturation = np.max(R, axis=1)  # Max saturation per path
    mean_sat = float(np.mean(max_saturation))
    std_sat = float(np.std(max_saturation))

    # Risk probability: fraction of paths exceeding critical threshold (0.6)
    critical_threshold = 0.6
    risk_prob = float(np.mean(max_saturation > critical_threshold))

    # ── Classify alert level ──────────────────────────────────
    if risk_prob > 0.7:
        alert = AlertLevel.CRITICAL
    elif risk_prob > 0.4:
        alert = AlertLevel.HIGH
    elif risk_prob > 0.15:
        alert = AlertLevel.MEDIUM
    else:
        alert = AlertLevel.LOW

    elapsed_ms = (time.time() - start_time) * 1000
    log.info(
        f"Simulation complete: {n_sims} paths, {elapsed_ms:.1f}ms, "
        f"risk_prob={risk_prob:.3f}, alert={alert.value}"
    )

    return CIRSimulationOutput(
        risk_probability=round(risk_prob, 4),
        mean_saturation=round(mean_sat, 4),
        std_saturation=round(std_sat, 4),
        alert_level=alert,
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
