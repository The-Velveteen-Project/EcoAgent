import { describe, expect, it, vi } from 'vitest';
import { LocalCIREngine } from './LocalCIREngine.js';
import { mapAlertLevel } from './jacobiModel.js';

vi.mock('../../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('LocalCIREngine', () => {
  it('produces a valid CIR output shape within expected bounds', async () => {
    const engine = new LocalCIREngine();

    const result = await engine.simulate({
      precipitation_mm: 14,
      humidity_pct: 86,
      temperature_c: 18,
      n_simulations: 250,
      time_horizon_hours: 24,
      S0: 0.4,
      rain_series: new Array(24).fill(14 / 24),
      dt_hours: 1,
      seed: 11,
    });

    expect(result.risk_probability).toBeGreaterThanOrEqual(0);
    expect(result.risk_probability).toBeLessThanOrEqual(1);
    expect(result.mean_saturation).toBeGreaterThanOrEqual(0);
    expect(result.std_saturation).toBeGreaterThanOrEqual(0);
    expect(result.prob_failure).toBe(result.risk_probability);
    expect(result.S_mean).toBe(result.mean_saturation);
    expect(result.S_std).toBe(result.std_saturation);
    expect(result.S_q_high).toBeGreaterThanOrEqual(result.S_mean);
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.alert_level);
  });

  it('accepts site metadata while remaining backward compatible', async () => {
    const engine = new LocalCIREngine();

    const result = await engine.simulate({
      precipitation_mm: 14,
      humidity_pct: 86,
      temperature_c: 18,
      n_simulations: 250,
      time_horizon_hours: 24,
      S0: 0.4,
      rain_series: new Array(24).fill(14 / 24),
      dt_hours: 1,
      seed: 11,
      site_id: 'configured-site:test',
      site: {
        id: 'configured-site:test',
        name: 'Configured Site',
        lat: 5.0703,
        lon: -75.5138,
        covariates: {
          slope: null,
          land_cover: null,
        },
      },
    });

    expect(result.risk_probability).toBeGreaterThanOrEqual(0);
    expect(result.risk_probability).toBeLessThanOrEqual(1);
  });

  it('is reproducible under the same seed', async () => {
    const engine = new LocalCIREngine();
    const input = {
      precipitation_mm: 20,
      humidity_pct: 85,
      temperature_c: 17,
      n_simulations: 300,
      time_horizon_hours: 24,
      S0: 0.42,
      rain_series: new Array(24).fill(20 / 24),
      dt_hours: 1,
      seed: 99,
    } as const;

    const a = await engine.simulate(input);
    const b = await engine.simulate(input);

    expect(a).toEqual(b);
  });

  it('changes when the rainfall forcing series changes despite the same accumulated rainfall', async () => {
    const engine = new LocalCIREngine();

    const flat = await engine.simulate({
      precipitation_mm: 24,
      humidity_pct: 80,
      temperature_c: 18,
      n_simulations: 300,
      time_horizon_hours: 24,
      S0: 0.4,
      rain_series: new Array(24).fill(1),
      dt_hours: 1,
      seed: 5,
    });

    const frontLoaded = await engine.simulate({
      precipitation_mm: 24,
      humidity_pct: 80,
      temperature_c: 18,
      n_simulations: 300,
      time_horizon_hours: 24,
      S0: 0.4,
      rain_series: [12, 12, ...new Array(22).fill(0)],
      dt_hours: 1,
      seed: 5,
    });

    expect(flat.S_mean).not.toBe(frontLoaded.S_mean);
  });

  it('changes when S0 changes', async () => {
    const engine = new LocalCIREngine();
    const common = {
      precipitation_mm: 10,
      humidity_pct: 78,
      temperature_c: 19,
      n_simulations: 300,
      time_horizon_hours: 24,
      rain_series: new Array(24).fill(10 / 24),
      dt_hours: 1,
      seed: 17,
    } as const;

    const low = await engine.simulate({ ...common, S0: 0.2 });
    const high = await engine.simulate({ ...common, S0: 0.8 });

    expect(low.S_mean).not.toBe(high.S_mean);
  });

  it('keeps reported saturation summaries inside [0,1]', async () => {
    const engine = new LocalCIREngine();

    const result = await engine.simulate({
      precipitation_mm: 120,
      humidity_pct: 100,
      temperature_c: 8,
      n_simulations: 400,
      time_horizon_hours: 24,
      S0: 0.95,
      rain_series: new Array(24).fill(5),
      dt_hours: 1,
      seed: 123,
    });

    expect(result.S_mean).toBeGreaterThanOrEqual(0);
    expect(result.S_mean).toBeLessThanOrEqual(1);
    expect(result.S_q_high).toBeGreaterThanOrEqual(0);
    expect(result.S_q_high).toBeLessThanOrEqual(1);
  });

  it('preserves legacy compatibility when rain_series and S0 are omitted', async () => {
    const engine = new LocalCIREngine();

    const result = await engine.simulate({
      precipitation_mm: 14,
      humidity_pct: 86,
      temperature_c: 18,
      n_simulations: 250,
      time_horizon_hours: 24,
      seed: 1,
    });

    expect(result.model_version).toBe('jacobi_rainfall_forced_v2');
    expect(result.risk_probability).toBeGreaterThanOrEqual(0);
  });

  it('maps alert levels with the A25-anchored exceedance bands', () => {
    expect(mapAlertLevel(0.1)).toBe('LOW');
    expect(mapAlertLevel(0.2)).toBe('MEDIUM');
    expect(mapAlertLevel(0.5)).toBe('HIGH');
    expect(mapAlertLevel(0.8)).toBe('CRITICAL');
  });
});
