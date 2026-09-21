# ---
# Pydantic v2 I/O schema for the ALLO simulation engine.
#
# Field docs describe the ACTUAL physics of the Jacobi rainfall-forced model (MODEL_CARD §4),
# not the retired CIR mean-reversion model. Validators reject physically impossible inputs
# before they reach the SDE (fail fast).
#
# Compatibility: the canonical classes are SimulationInput / SimulationOutput. The old names
# CIRSimulationInput / CIRSimulationOutput are kept as aliases, and the output exposes the
# legacy field names (risk_probability, mean_saturation, std_saturation,
# hazard_probability_mean) as computed properties so the TypeScript contract keeps working
# during migration. That contract is pinned by tests/test_contract.py on this side and by
# src/infrastructure/simulation/pythonContract.test.ts on the TypeScript side.
#
# ARCHIVO: eco-stochast-poc/python_engine/models.py
# ---

from enum import StrEnum

from pydantic import BaseModel, Field, computed_field, field_validator

from config import settings


class AlertLevel(StrEnum):
    """Discrete risk classification derived from Monte Carlo simulation."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SimulationInput(BaseModel):
    """Input parameters for the rainfall-forced Jacobi saturation SDE (MODEL_CARD §4)."""

    precipitation_mm: float = Field(
        ..., ge=0,
        description="Accumulated precipitation (mm) over the horizon. Compatibility path: spread "
                    "evenly across the horizon as forcing when no temporal rain_series is given.",
    )
    humidity_pct: float = Field(
        default=0.0, ge=0, le=100,
        description="Relative humidity (0-100%). Carried for contract compatibility; the Jacobi "
                    "model is forced by rainfall, not by humidity as a mean shift.",
    )
    temperature_c: float = Field(
        default=0.0, ge=-50, le=60,
        description="Air temperature (°C). Higher temperature raises evapotranspiration, increasing "
                    "the drainage/relaxation rate lambda.",
    )
    n_simulations: int = Field(
        default=settings.default_n_simulations, ge=1,
        description="Number of Monte Carlo paths. More paths tighten the uncertainty estimate.",
    )
    time_horizon_hours: float = Field(
        default=24, gt=0,
        description="Forward projection horizon in hours.",
    )
    S0: float | None = Field(
        default=None, ge=0, le=1,
        description="Initial latent saturation S0 (MODEL_CARD §3). Should be the site's persisted "
                    "last estimate or a rainfall warm-up, never a hardcoded constant (invariant #2).",
    )
    rain_series: list[float] | None = Field(
        default=None,
        description="Rainfall forcing series across the horizon; each element is rainfall (mm) for "
                    "one dt_hours bin. Rainfall enters as forcing (invariant #1).",
    )
    dt_hours: float | None = Field(
        default=None, gt=0,
        description="Time-step size in hours for each rain_series bin (single declared time step).",
    )
    seed: int | None = Field(
        default=None, ge=0,
        description="Seed for reproducible Monte Carlo simulation (invariant #4).",
    )
    site_id: str | None = Field(
        default=None,
        description="Optional site identifier for per-site persistence and covariates.",
    )
    site: dict | None = Field(
        default=None,
        description="Optional site payload with terrain covariates (slope, twi, lithology, soil).",
    )

    @field_validator("n_simulations")
    @classmethod
    def check_max_simulations(cls, v: int) -> int:
        if v > settings.max_simulations:
            raise ValueError(f"n_simulations ({v}) exceeds maximum allowed ({settings.max_simulations})")
        return v

    @field_validator("rain_series")
    @classmethod
    def check_rain_series(cls, v: list[float] | None) -> list[float] | None:
        if v is None:
            return v
        if len(v) == 0:
            raise ValueError("rain_series must contain at least one value")
        if any(value < 0 for value in v):
            raise ValueError("rain_series cannot contain negative rainfall values")
        return v


class SimulationOutput(BaseModel):
    """Result of the Jacobi rainfall-forced simulation.

    `prob_failure` is THE failure probability: the hazard-link path probability
    P = 1 - exp(-∫h ds), averaged over Monte Carlo paths (MODEL_CARD §4, invariant #6), stated
    over `alert_window_days` — the window the alert cut points are defined on.
    `exceedance_fraction` is a separate diagnostic (fraction of paths whose peak saturation
    crossed Sc); it is explicitly NOT "the probability".
    """

    prob_failure: float = Field(
        ..., ge=0, le=1,
        description="Mean hazard-link failure probability P = 1 - exp(-∫h ds) over the horizon.",
    )
    prob_failure_q05: float = Field(
        ..., ge=0, le=1, description="5th percentile of per-path failure probability (uncertainty band).",
    )
    prob_failure_q95: float = Field(
        ..., ge=0, le=1, description="95th percentile of per-path failure probability (uncertainty band).",
    )
    prob_failure_horizon: float | None = Field(
        default=None, ge=0, le=1,
        description="AUXILIARY: the same hazard-link probability over the simulated horizon only "
                    "(horizon_days), before it is carried to the alert window. Not what the alert maps.",
    )
    horizon_days: float | None = Field(default=None, gt=0, description="Length of the simulated horizon, in days.")
    alert_window_days: float | None = Field(
        default=None, gt=0,
        description="Window (days) over which prob_failure is stated and the alert cut points apply.",
    )
    exceedance_fraction: float = Field(
        ..., ge=0, le=1,
        description="DIAGNOSTIC ONLY: fraction of paths whose peak saturation exceeded Sc. Not the probability.",
    )
    S_mean: float = Field(..., ge=0, le=1, description="Mean peak saturation over the horizon.")
    S_std: float = Field(..., ge=0, description="Std. dev. of peak saturation (simulation uncertainty).")
    S_q_high: float = Field(..., ge=0, le=1, description="95th-percentile peak saturation.")
    feller_low_ok: bool = Field(
        ..., description="Whether kappa*rho >= sigma^2/2 held (boundary non-attainment near S=0).",
    )
    feller_high_ok: bool = Field(
        ..., description="Whether lambda >= sigma^2/2 held (boundary non-attainment near S=1).",
    )
    model_version: str = Field(..., description="Internal model version string.")
    alert_level: AlertLevel = Field(
        ..., description="Discrete alert classification: LOW, MEDIUM, HIGH, CRITICAL.",
    )

    # --- Backward-compatible aliases for the existing TypeScript contract ---
    @computed_field  # type: ignore[misc]
    @property
    def risk_probability(self) -> float:
        """Legacy alias for prob_failure (TS contract compatibility)."""
        return self.prob_failure

    @computed_field  # type: ignore[misc]
    @property
    def hazard_probability_mean(self) -> float:
        """Legacy alias for prob_failure (TS contract compatibility).

        The TypeScript output schema REQUIRES this key. In the v2 engine it carried the
        hazard-link probability next to a path-count `prob_failure`; in this engine the
        hazard-link probability IS `prob_failure`, so the two are the same number. Dropping the
        key makes every response fail schema validation on the bot side, which silently routes
        100% of requests to the fallback engine.
        """
        return self.prob_failure

    @computed_field  # type: ignore[misc]
    @property
    def mean_saturation(self) -> float:
        """Legacy alias for S_mean."""
        return self.S_mean

    @computed_field  # type: ignore[misc]
    @property
    def std_saturation(self) -> float:
        """Legacy alias for S_std."""
        return self.S_std

    @property
    def is_high_risk(self) -> bool:
        """Whether the alert level requires immediate attention."""
        return self.alert_level in (AlertLevel.HIGH, AlertLevel.CRITICAL)

    @property
    def summary(self) -> str:
        """Human-readable summary ready to send to the LLM."""
        return (
            f"Nivel de riesgo: {self.alert_level.value}. "
            f"Probabilidad de falla: {self.prob_failure:.1%} "
            f"(90% IC {self.prob_failure_q05:.1%}-{self.prob_failure_q95:.1%}). "
            f"Saturación media: {self.S_mean:.3f} ± {self.S_std:.3f}."
        )


# --- Compatibility aliases (old class names) ---
CIRSimulationInput = SimulationInput
CIRSimulationOutput = SimulationOutput
