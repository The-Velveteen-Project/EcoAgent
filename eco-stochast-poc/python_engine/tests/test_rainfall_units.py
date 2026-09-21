"""The wetting response must see rainfall INTENSITY (mm/day), not depth per bin.

rain_half_mm is a half-saturation in mm/day, the unit the hazard link was calibrated in. The
bot posts hourly bins; the calibration used daily ones. If rho() is fed the raw per-bin depth,
the same storm wets the soil differently depending on how finely it is binned, and a model
calibrated at one resolution is silently a different model at another.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from config import model_params
from main import rho_of_rain, simulate

PARAMS = {
    "kappa": model_params.kappa,
    "lambda": model_params.lam,
    "sigma": model_params.sigma,
    "rain_half_mm": model_params.rain_half_mm,
    "h0": model_params.h0,
    "beta": model_params.beta,
    "critical_saturation": model_params.critical_saturation,
}

STORM_MM = 120.0  # total depth over 24 h


def _peak_saturation(n_bins: int) -> float:
    rain = np.full(n_bins, STORM_MM / n_bins)
    result = simulate(rain, dt_days=1.0 / n_bins, s0=0.6, n_sims=4000, params=PARAMS, seed=11)
    return result["S_mean"]


class RainfallUnitsTests(unittest.TestCase):
    def test_refining_the_bins_does_not_change_the_wetting(self):
        # 24 hourly bins vs 48 half-hour bins of the same storm: same intensity, so the mean
        # peak saturation must agree up to Monte Carlo / discretization noise.
        self.assertAlmostEqual(_peak_saturation(24), _peak_saturation(48), delta=0.02)

    def test_hourly_and_daily_binning_agree_up_to_euler_error(self):
        # One coarse daily Euler step overshoots the hourly solution, but only by the
        # discretization error of the step. Fed raw depths, the gap was 0.20 (0.63 vs 0.83).
        self.assertAlmostEqual(_peak_saturation(24), _peak_saturation(1), delta=0.10)

    def _noise_free_peak(self, rain: np.ndarray, dt_days: float, s0: float) -> float:
        """Hand-rolled Euler reference with sigma = 0 and rho fed mm/day."""
        S = peak = s0
        for depth in rain:
            intensity = depth / dt_days
            rho = intensity / (intensity + PARAMS["rain_half_mm"])
            S = S + (PARAMS["kappa"] * rho * (1.0 - S) - PARAMS["lambda"] * S) * dt_days
            S = min(max(S, 0.0), 1.0)
            peak = max(peak, S)
        return peak

    def test_daily_bins_use_the_daily_depth_as_mm_per_day(self):
        # For dt = 1 day, depth per bin and intensity per day are the same number, so the
        # resolution the hazard link was calibrated at is untouched by the conversion.
        rain = np.array([0.0, 12.0, 45.0, 3.0, 80.0])
        result = simulate(rain, dt_days=1.0, s0=0.4, n_sims=8, params={**PARAMS, "sigma": 0.0}, seed=1)
        self.assertAlmostEqual(result["S_mean"], self._noise_free_peak(rain, 1.0, 0.4), places=12)

    def test_hourly_bins_are_converted_to_mm_per_day(self):
        rain = np.full(24, 5.0)  # 5 mm in each hour = 120 mm/day
        result = simulate(rain, dt_days=1.0 / 24, s0=0.6, n_sims=8, params={**PARAMS, "sigma": 0.0}, seed=1)
        self.assertAlmostEqual(result["S_mean"], self._noise_free_peak(rain, 1.0 / 24, 0.6), places=12)

    def test_half_saturation_is_reached_at_rain_half_mm_per_day(self):
        self.assertAlmostEqual(float(rho_of_rain(model_params.rain_half_mm, model_params.rain_half_mm)), 0.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
