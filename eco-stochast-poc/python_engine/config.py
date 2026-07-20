# ---
# 📚 WHY: Centralizes the Python engine configuration with pydantic-settings.
#    The CIR parameters (a, b, sigma) are calibrated for Manizales and must be
#    easily adjustable without touching code. Without this, the parameters would be
#    hardcoded in the simulation function, impossible to change in deployment.
# 📁 FILE: eco-stochast-poc/python_engine/config.py
# ---

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration for the CIR simulation engine."""

    # Server
    port: int = 8000
    log_level: str = "INFO"

    # CIR Model Parameters (calibrated for Manizales, Colombia)
    cir_mean_reversion_speed: float = 0.5   # Parameter 'a': speed of mean reversion
    cir_long_term_mean: float = 0.4         # Parameter 'b': long-term mean (Manizales baseline)
    cir_volatility: float = 0.1             # Parameter 'sigma': diffusion coefficient

    # Simulation Limits
    max_simulations: int = 10000  # Single source of truth for n_simulations upper bound

    model_config = SettingsConfigDict(
        env_prefix="CIR_",
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
