# ---
# 📚 POR QUÉ: Define modelos Pydantic v2 con validación física y documentación inline.
#    Cada campo tiene Field(description=...) explicando la física subyacente, lo que
#    permite generar documentación API automática en /docs. Los validators rechazan
#    inputs físicamente imposibles (precipitación negativa, exceso de simulaciones)
#    ANTES de que lleguen al motor SDE — fail fast.
# 📁 ARCHIVO: eco-stochast-poc/python_engine/models.py
# ---

from enum import StrEnum

from pydantic import BaseModel, Field, field_validator

from config import settings


class AlertLevel(StrEnum):
    """Discrete risk classification derived from Monte Carlo simulation."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class CIRSimulationInput(BaseModel):
    """Input parameters for the Cox-Ingersoll-Ross stochastic simulation."""

    precipitation_mm: float = Field(
        ...,
        ge=0,
        description="Accumulated precipitation in mm. Drives soil moisture increase in the CIR drift term.",
    )
    humidity_pct: float = Field(
        ...,
        ge=0,
        le=100,
        description="Relative humidity (0–100%). Amplifies the long-term mean 'b' in the CIR model.",
    )
    temperature_c: float = Field(
        ...,
        ge=-50,
        le=60,
        description="Air temperature in °C. Physical range for surface air. Higher temps increase evapotranspiration, reducing soil saturation.",
    )
    n_simulations: int = Field(
        default=1000,
        ge=1,
        description="Number of Monte Carlo paths to simulate. More paths = higher statistical confidence.",
    )
    time_horizon_hours: float = Field(
        default=24,
        gt=0,
        description="Forward projection horizon in hours. Longer = more uncertainty in the forecast.",
    )
    S0: float | None = Field(
        default=None,
        ge=0,
        le=1,
        description="Initial latent saturation state. New official path from MODEL_CARD.md §3.",
    )
    rain_series: list[float] | None = Field(
        default=None,
        description="Rainfall forcing series across the horizon. Each element is the rainfall amount for one dt_hours bin.",
    )
    dt_hours: float | None = Field(
        default=None,
        gt=0,
        description="Time-step size in hours for each rain_series bin.",
    )
    seed: int | None = Field(
        default=None,
        ge=0,
        description="Seed for reproducible Monte Carlo simulation.",
    )
    site_id: str | None = Field(
        default=None,
        description="Optional site identifier for future per-site persistence and covariates.",
    )
    site: dict | None = Field(
        default=None,
        description="Optional site payload. Accepted for compatibility with the TypeScript contract.",
    )

    @field_validator("n_simulations")
    @classmethod
    def check_max_simulations(cls, v: int) -> int:
        if v > settings.max_simulations:
            raise ValueError(
                f"n_simulations ({v}) exceeds maximum allowed ({settings.max_simulations})"
            )
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



class CIRSimulationOutput(BaseModel):
    """Result of the CIR stochastic simulation."""

    prob_failure: float = Field(
        ...,
        ge=0,
        le=1,
        description="Probability of exceeding the critical saturation threshold over the horizon.",
    )
    S_mean: float = Field(
        ...,
        ge=0,
        le=1,
        description="Mean peak saturation over the simulation horizon.",
    )
    S_std: float = Field(
        ...,
        ge=0,
        description="Standard deviation of peak saturation over the horizon.",
    )
    S_q_high: float = Field(
        ...,
        ge=0,
        le=1,
        description="High quantile of peak saturation over the horizon.",
    )
    hazard_probability_mean: float = Field(
        ...,
        ge=0,
        le=1,
        description="Mean hazard-derived path failure probability across Monte Carlo paths.",
    )
    model_version: str = Field(
        ...,
        description="Internal model version string for non-breaking schema evolution.",
    )

    risk_probability: float = Field(
        ...,
        ge=0,
        le=1,
        description="Probability of exceeding critical soil saturation (0–1).",
    )
    mean_saturation: float = Field(
        ...,
        description="Mean soil saturation level across all Monte Carlo paths.",
    )
    std_saturation: float = Field(
        ...,
        ge=0,
        description="Standard deviation of saturation — quantifies simulation uncertainty.",
    )
    alert_level: AlertLevel = Field(
        ...,
        description="Discrete alert classification: LOW, MEDIUM, HIGH, CRITICAL.",
    )

    @property
    def is_high_risk(self) -> bool:
        """Whether the alert level requires immediate attention."""
        return self.alert_level in (AlertLevel.HIGH, AlertLevel.CRITICAL)

    @property
    def summary(self) -> str:
        """Human-readable summary ready to send to the LLM."""
        return (
            f"Nivel de riesgo: {self.alert_level.value}. "
            f"Probabilidad: {self.prob_failure:.1%}. "
            f"Saturación media: {self.S_mean:.4f} ± {self.S_std:.4f}."
        )
