"""Tests for the refactored Jacobi rainfall-forced engine (main.py + models.py + config.py)."""
from __future__ import annotations
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from config import model_params
from main import simulate, resolve_terrain_params, rho_of_rain, feller_conditions, map_alert_level
from models import SimulationInput, SimulationOutput, CIRSimulationInput, AlertLevel


def _params():
    return {
        "kappa": model_params.kappa, "lambda": model_params.lam, "sigma": model_params.sigma,
        "rain_half_mm": model_params.rain_half_mm, "h0": model_params.h0, "beta": model_params.beta,
        "critical_saturation": model_params.critical_saturation,
    }


class EngineTests(unittest.TestCase):
    def test_rng_is_reproducible(self):
        rain = np.full(30, 20.0)
        a = simulate(rain, dt_days=1.0, s0=0.3, n_sims=500, params=_params(), seed=7)
        b = simulate(rain, dt_days=1.0, s0=0.3, n_sims=500, params=_params(), seed=7)
        self.assertEqual(a["prob_failure"], b["prob_failure"])
        self.assertEqual(a["S_mean"], b["S_mean"])

    def test_different_seeds_differ(self):
        rain = np.full(30, 20.0)
        a = simulate(rain, dt_days=1.0, s0=0.3, n_sims=500, params=_params(), seed=7)
        b = simulate(rain, dt_days=1.0, s0=0.3, n_sims=500, params=_params(), seed=8)
        self.assertNotEqual(a["S_mean"], b["S_mean"])

    def test_more_rain_increases_saturation_and_prob(self):
        p = _params()
        dry = simulate(np.full(30, 2.0), dt_days=1.0, s0=0.3, n_sims=1000, params=p, seed=1)
        wet = simulate(np.full(30, 60.0), dt_days=1.0, s0=0.3, n_sims=1000, params=p, seed=1)
        self.assertGreater(wet["S_mean"], dry["S_mean"])
        self.assertGreaterEqual(wet["prob_failure"], dry["prob_failure"])

    def test_rho_is_monotone_and_bounded(self):
        r = np.array([0.0, 10.0, 30.0, 100.0, 1000.0])
        rho = rho_of_rain(r, 30.0)
        self.assertTrue(np.all(np.diff(rho) > 0))
        self.assertTrue(np.all((rho >= 0) & (rho < 1)))

    def test_S0_sensitivity(self):
        p = _params()
        lo = simulate(np.full(20, 15.0), dt_days=1.0, s0=0.1, n_sims=1000, params=p, seed=3)
        hi = simulate(np.full(20, 15.0), dt_days=1.0, s0=0.7, n_sims=1000, params=p, seed=3)
        self.assertGreater(hi["S_mean"], lo["S_mean"])

    def test_saturation_bounded_unit_interval(self):
        r = simulate(np.full(60, 200.0), dt_days=1.0, s0=0.5, n_sims=2000, params=_params(), seed=5)
        self.assertGreaterEqual(r["S_mean"], 0.0)
        self.assertLessEqual(r["S_q_high"], 1.0)

    def test_feller_flags_returned(self):
        r = simulate(np.full(20, 20.0), dt_days=1.0, s0=0.3, n_sims=200, params=_params(), seed=1)
        self.assertIn("feller_low_ok", r)
        self.assertIn("feller_high_ok", r)
        # default params satisfy both
        self.assertTrue(r["feller_high_ok"])

    def test_prob_failure_is_hazard_link_not_exceedance(self):
        # The two quantities are distinct; prob_failure must be the hazard-link one.
        r = simulate(np.full(30, 40.0), dt_days=1.0, s0=0.4, n_sims=2000, params=_params(), seed=9)
        self.assertNotEqual(r["prob_failure"], r["exceedance_fraction"])
        self.assertLessEqual(r["prob_failure_q05"], r["prob_failure_q95"])

    def test_no_cir_mean_reversion_params(self):
        # Legacy CIR knobs must be gone.
        self.assertFalse(hasattr(model_params, "cir_long_term_mean"))
        self.assertFalse(hasattr(model_params, "cir_mean_reversion_speed"))

    def test_output_legacy_aliases_present(self):
        out = SimulationOutput(prob_failure=0.3, prob_failure_q05=0.1, prob_failure_q95=0.5,
                               exceedance_fraction=0.4, S_mean=0.6, S_std=0.1, S_q_high=0.8,
                               feller_low_ok=True, feller_high_ok=True, model_version="t",
                               alert_level=AlertLevel.MEDIUM)
        d = out.model_dump()
        self.assertEqual(d["risk_probability"], 0.3)
        self.assertEqual(d["mean_saturation"], 0.6)
        self.assertAlmostEqual(d["std_saturation"], 0.1)

    def test_input_alias_class(self):
        self.assertIs(CIRSimulationInput, SimulationInput)
        inp = SimulationInput(precipitation_mm=50.0)
        self.assertEqual(inp.n_simulations, model_params_default())

    def test_terrain_covariates_shift_params(self):
        base = SimulationInput(precipitation_mm=10.0)
        steep = SimulationInput(precipitation_mm=10.0, site={"covariates": {"slope": 30, "lithology": "weak ash"}})
        pb = resolve_terrain_params(base); ps = resolve_terrain_params(steep)
        self.assertLess(ps["critical_saturation"], pb["critical_saturation"])  # steeper/weaker -> lower Sc
        self.assertGreater(ps["lambda"], pb["lambda"])  # steeper -> more drainage


def model_params_default():
    from config import settings
    return settings.default_n_simulations


if __name__ == "__main__":
    unittest.main(verbosity=2)
