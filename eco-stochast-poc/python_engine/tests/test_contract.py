"""Cross-language contract between this engine and the TypeScript bot.

The bot validates every /simulate_risk response with a Zod schema
(src/domain/ports/ISimulationEngine.ts). A response that fails validation raises
SimulationValidationError, and FailoverSimulationEngine answers from the local fallback
instead, logging only a warning. A missing key therefore does not crash anything: it silently
retires this engine from service. That happened once (`hazard_probability_mean` was dropped in
the v3 refactor), so the contract is pinned from both sides:

  - here: the response built by the real endpoint has exactly the shape of the committed
    fixture, and carries every key the TypeScript schema requires;
  - src/infrastructure/simulation/pythonContract.test.ts: that same fixture parses under the
    real Zod schema.

Regenerate the fixture after a deliberate contract change with:
    python tests/test_contract.py --write
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import ModelParams, Settings
from main import MODEL_VERSION, simulate_risk
from models import SimulationInput

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "simulate_risk_response.json"

# Keys required by JacobiSimulationOutputSchema on the TypeScript side. Extra keys are fine
# (Zod strips them); a missing one takes the primary engine out of service.
REQUIRED_BY_TYPESCRIPT = (
    "prob_failure",
    "S_mean",
    "S_std",
    "S_q_high",
    "hazard_probability_mean",
    "model_version",
    "risk_probability",
    "mean_saturation",
    "std_saturation",
    "alert_level",
)

# The payload RiskAnalysisUseCase actually posts: 24 hourly bins over a 24 h horizon.
BOT_REQUEST = dict(
    precipitation_mm=120.0,
    humidity_pct=85.0,
    temperature_c=17.0,
    n_simulations=1000,
    time_horizon_hours=24,
    S0=0.6,
    rain_series=[5.0] * 24,
    dt_hours=1,
    seed=12345,
    site_id="manizales-default",
    site=None,
)


def build_response() -> dict:
    output = asyncio.run(simulate_risk(SimulationInput(**BOT_REQUEST)))
    return output.model_dump(mode="json")


def _json_type(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return type(value).__name__


class ContractTests(unittest.TestCase):
    def test_response_carries_every_key_typescript_requires(self):
        response = build_response()
        missing = [key for key in REQUIRED_BY_TYPESCRIPT if key not in response]
        self.assertEqual(missing, [], f"TypeScript schema would reject the response: missing {missing}")

    def test_response_shape_matches_committed_fixture(self):
        response = build_response()
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(sorted(response), sorted(fixture), "key set drifted; regenerate the fixture deliberately")
        self.assertEqual(
            {key: _json_type(value) for key, value in response.items()},
            {key: _json_type(value) for key, value in fixture.items()},
        )

    def test_legacy_aliases_equal_the_canonical_fields(self):
        response = build_response()
        self.assertEqual(response["hazard_probability_mean"], response["prob_failure"])
        self.assertEqual(response["risk_probability"], response["prob_failure"])
        self.assertEqual(response["mean_saturation"], response["S_mean"])
        self.assertEqual(response["std_saturation"], response["S_std"])

    def test_fixture_was_produced_by_this_model_version(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(fixture["model_version"], MODEL_VERSION)


class ConfigLoadingTests(unittest.TestCase):
    def test_hazard_parameter_in_env_file_does_not_break_sibling_settings(self):
        # ModelParams and Settings share the ALLO_ prefix and the same .env file. A calibrated
        # hazard parameter placed there must reach ModelParams without making Settings raise.
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text("ALLO_H0=0.01677\nALLO_LOG_LEVEL=WARNING\n", encoding="utf-8")
            params = ModelParams(_env_file=env_file)
            server = Settings(_env_file=env_file)
        self.assertAlmostEqual(params.h0, 0.01677)
        self.assertEqual(server.log_level, "WARNING")


if __name__ == "__main__":
    if "--write" in sys.argv:
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(build_response(), indent=2) + "\n", encoding="utf-8")
        print(f"wrote {FIXTURE}")
    else:
        unittest.main(verbosity=2)
