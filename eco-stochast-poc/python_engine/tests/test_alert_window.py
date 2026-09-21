"""The alert cut points apply to the probability over the 25-day policy window.

The cut points 0.15 / 0.40 / 0.70 are a decision policy on the failure probability integrated
over the A25 window (25 days); the calibration's rainfall-trigger table was computed on that
quantity. The bot asks for a 24 h horizon. Mapping the 24 h probability through the same cut
points yields an early-warning system that cannot warn: with S = 1 for the whole day the 24 h
probability is 0.10, below the MEDIUM cut point.
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from config import model_params
from main import map_alert_level, simulate, simulate_risk
from models import AlertLevel, SimulationInput

PARAMS = {
    "kappa": model_params.kappa,
    "lambda": model_params.lam,
    "sigma": model_params.sigma,
    "rain_half_mm": model_params.rain_half_mm,
    "h0": model_params.h0,
    "beta": model_params.beta,
    "critical_saturation": model_params.critical_saturation,
}
HOURLY_STORM = np.full(24, 5.0)  # the bot's call pattern: 24 hourly bins


def _run(s0: float, window: float | None, params: dict = PARAMS) -> dict:
    return simulate(HOURLY_STORM, dt_days=1 / 24, s0=s0, n_sims=2000, params=params, seed=5,
                    alert_window_days=window)


class AlertWindowTests(unittest.TestCase):
    def test_policy_window_is_the_a25_window(self):
        self.assertEqual(model_params.alert_horizon_days, 25.0)

    def test_without_a_window_the_probability_is_over_the_simulated_horizon(self):
        r = _run(0.6, None)
        self.assertEqual(r["prob_failure"], r["prob_failure_horizon"])
        self.assertAlmostEqual(r["horizon_days"], 1.0)

    def test_window_probability_is_the_same_hazard_carried_to_25_days(self):
        # sigma = 0 and S below Sc: hazard is the constant h0, so both numbers are closed-form.
        r = _run(0.2, 25.0, {**PARAMS, "sigma": 0.0})
        self.assertAlmostEqual(r["prob_failure_horizon"], 1 - np.exp(-PARAMS["h0"] * 1.0), places=12)
        self.assertAlmostEqual(r["prob_failure"], 1 - np.exp(-PARAMS["h0"] * 25.0), places=12)

    def test_24h_probability_alone_cannot_leave_low(self):
        # The defect this window fixes, pinned as a fact about the 24 h number.
        saturated = _run(1.0, None, {**PARAMS, "sigma": 0.0, "lambda": 0.0})
        self.assertLess(saturated["prob_failure_horizon"], 0.15)
        self.assertEqual(map_alert_level(saturated["prob_failure_horizon"]), AlertLevel.LOW)

    def test_alert_levels_above_low_are_reachable_on_the_policy_window(self):
        wet = _run(0.95, 25.0)
        self.assertIn(map_alert_level(wet["prob_failure"]), (AlertLevel.HIGH, AlertLevel.CRITICAL))

    def test_endpoint_maps_the_alert_from_the_window_probability(self):
        out = asyncio.run(simulate_risk(SimulationInput(
            precipitation_mm=120.0, temperature_c=17.0, humidity_pct=85.0, n_simulations=1000,
            time_horizon_hours=24, S0=0.95, rain_series=[5.0] * 24, dt_hours=1, seed=5,
        )))
        self.assertEqual(out.alert_window_days, 25.0)
        self.assertEqual(out.alert_level, map_alert_level(out.prob_failure))
        self.assertGreater(out.prob_failure, out.prob_failure_horizon)


if __name__ == "__main__":
    unittest.main(verbosity=2)
