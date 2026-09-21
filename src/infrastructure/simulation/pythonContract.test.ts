// ---
// 📚 WHY: PythonJacobiEngine validates every response of the Python service against
//    JacobiSimulationOutputSchema, and FailoverSimulationEngine treats a validation error as a
//    reason to answer from the local fallback. So a key missing on the Python side does not
//    crash anything: it silently retires the primary engine and every request is served by the
//    fallback, with only a warning in the logs. The v3 refactor of the Python engine dropped
//    `hazard_probability_mean` and would have done exactly that.
//
//    The unit tests of PythonJacobiEngine mock the HTTP response, so they cannot see this.
//    This suite parses a response produced by the REAL Python endpoint (committed as a fixture
//    and shape-checked on the Python side by tests/test_contract.py) with the REAL Zod schema.
// 📁 FILE: src/infrastructure/simulation/pythonContract.test.ts
// ---

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JacobiSimulationOutputSchema } from '../../domain/ports/ISimulationEngine.js';
import { JACOBI_MODEL_VERSION, mapAlertLevel } from './jacobiModel.js';

const FIXTURE_URL = new URL(
  '../../../eco-stochast-poc/python_engine/tests/fixtures/simulate_risk_response.json',
  import.meta.url
);

const pythonResponse = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as Record<string, unknown>;

describe('Python engine ↔ TypeScript contract', () => {
  it('accepts a response produced by the real Python endpoint', () => {
    const parsed = JacobiSimulationOutputSchema.safeParse(pythonResponse);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('would reject the response if the Python side dropped hazard_probability_mean', () => {
    const { hazard_probability_mean: _dropped, ...withoutAlias } = pythonResponse;
    const parsed = JacobiSimulationOutputSchema.safeParse(withoutAlias);
    expect(parsed.success).toBe(false);
  });

  it('reports the same model version on both sides', () => {
    expect(pythonResponse.model_version).toBe(JACOBI_MODEL_VERSION);
  });

  it('maps the probability to the same alert level on both sides', () => {
    expect(pythonResponse.alert_level).toBe(mapAlertLevel(pythonResponse.prob_failure as number));
  });
});
