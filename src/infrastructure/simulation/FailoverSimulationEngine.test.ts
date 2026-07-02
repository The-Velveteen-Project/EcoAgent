import { describe, expect, it, vi } from 'vitest';
import type { ISimulationEngine } from '../../domain/ports/ISimulationEngine.js';
import { FailoverSimulationEngine } from './FailoverSimulationEngine.js';
import {
  SimulationServiceUnavailableError,
  SimulationValidationError,
} from './errors.js';

vi.mock('../../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const INPUT = {
  precipitation_mm: 10,
  humidity_pct: 80,
  temperature_c: 19,
  n_simulations: 1000,
  time_horizon_hours: 24,
};

const OUTPUT = {
  prob_failure: 0.27,
  S_mean: 0.51,
  S_std: 0.07,
  S_q_high: 0.63,
  hazard_probability_mean: 0.22,
  model_version: 'jacobi_rainfall_forced_v2',
  risk_probability: 0.27,
  mean_saturation: 0.51,
  std_saturation: 0.07,
  alert_level: 'MEDIUM' as const,
};

describe('FailoverSimulationEngine', () => {
  it('uses the primary engine when it succeeds', async () => {
    const primary: ISimulationEngine = {
      simulate: vi.fn().mockResolvedValue(OUTPUT),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const fallback: ISimulationEngine = {
      simulate: vi.fn().mockResolvedValue({
        ...OUTPUT,
        alert_level: 'LOW' as const,
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const engine = new FailoverSimulationEngine(primary, fallback);
    const result = await engine.simulate(INPUT);

    expect(result.alert_level).toBe('MEDIUM');
    expect(primary.simulate).toHaveBeenCalledOnce();
    expect(fallback.simulate).not.toHaveBeenCalled();
  });

  it('falls back when the primary engine is unavailable', async () => {
    const primary: ISimulationEngine = {
      simulate: vi.fn().mockRejectedValue(
        new SimulationServiceUnavailableError('python engine down')
      ),
      healthCheck: vi.fn().mockResolvedValue(false),
    };
    const fallback: ISimulationEngine = {
      simulate: vi.fn().mockResolvedValue(OUTPUT),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const engine = new FailoverSimulationEngine(primary, fallback);
    const result = await engine.simulate(INPUT);

    expect(result.alert_level).toBe('MEDIUM');
    expect(primary.simulate).toHaveBeenCalledOnce();
    expect(fallback.simulate).toHaveBeenCalledOnce();
  });

  it('falls back when the primary engine returns an invalid contract', async () => {
    const primary: ISimulationEngine = {
      simulate: vi.fn().mockRejectedValue(
        new SimulationValidationError('schema mismatch')
      ),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const fallback: ISimulationEngine = {
      simulate: vi.fn().mockResolvedValue(OUTPUT),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const engine = new FailoverSimulationEngine(primary, fallback);
    const result = await engine.simulate(INPUT);

    expect(result.alert_level).toBe('MEDIUM');
    expect(fallback.simulate).toHaveBeenCalledOnce();
  });
});
