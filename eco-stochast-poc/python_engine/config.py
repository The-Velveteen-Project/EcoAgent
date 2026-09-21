# ---
# Configuration for the ALLO rainfall-forced Jacobi (Wright-Fisher) hazard engine.
#
# Scientific ground truth: docs/MODEL_CARD.md.
#   - §4 defines the SDE  dS = [kappa*rho(R)(1-S) - lambda*S] dt + sigma*sqrt(S(1-S)) dW
#     and the hazard link  h(S,X) = h0 * exp(beta * (S - Sc)_+).
#   - Invariant #1: rainfall enters as FORCING, never as a shift of an equilibrium mean.
#     The legacy CIR mean-reversion parameters (a, b) are therefore removed, not renamed.
#   - Invariant #5: hazard/alert parameters are CALIBRATED, never magic numbers. They live
#     here (env-overridable) as declared *priors / defaults*, to be replaced by values
#     estimated against the SIMMA/DesInventar inventory + rainfall record.
#
# ARCHIVO: eco-stochast-poc/python_engine/config.py
# ---

from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelParams(BaseSettings):
    """Jacobi-SDE + hazard-link parameters (MODEL_CARD.md §4).

    These are DEFAULTS/PRIORS, overridable via env (prefix ALLO_) and — once a dated
    inventory is available — replaced by calibrated estimates with uncertainty. They are
    not tuning knobs chosen for nice output (invariant #5).
    """

    # --- Saturation SDE (per-day rates) ---
    kappa: float = 0.9      # infiltration / wetting rate; higher for permeable andosols
    lam: float = 0.06       # drainage + evapotranspiration relaxation rate
    sigma: float = 0.10     # Jacobi diffusion amplitude
    rain_half_mm: float = 30.0  # rho(R) = R / (R + rain_half_mm): rainfall half-saturation (mm/day)

    # --- Hazard link  h = h0 * exp(beta * (S - Sc)_+) ---
    h0: float = 0.015       # baseline hazard rate (per day) at/below critical saturation
    beta: float = 9.0       # hazard sensitivity above critical saturation
    critical_saturation: float = 0.78  # Sc(X) default; lowered by slope / weak lithology

    # --- Decision-policy window ---
    # The alert cut points apply to the failure probability integrated over this window. 25 days
    # is the A25 antecedent-rainfall window of the Manizales early-warning system, and the window
    # the calibration's rainfall-trigger table was computed on.
    alert_horizon_days: float = 25.0

    # extra="ignore": ModelParams and Settings share the ALLO_ prefix and the same .env file, so
    # each class sees the other's keys there. Without this, setting e.g. ALLO_H0 in .env makes
    # Settings() raise extra_forbidden at import time and the service does not start.
    model_config = SettingsConfigDict(
        env_prefix="ALLO_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


class Settings(BaseSettings):
    """Server + simulation configuration for the ALLO engine."""

    # Server
    port: int = 8000
    log_level: str = "INFO"

    # Simulation limits / numerics
    max_simulations: int = 10000   # single source of truth for n_simulations upper bound
    default_n_simulations: int = 2000
    default_S0: float = 0.3        # cold-start prior when no persisted/warm-up state (underestimates by design)

    model_config = SettingsConfigDict(
        env_prefix="ALLO_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


settings = Settings()
model_params = ModelParams()
