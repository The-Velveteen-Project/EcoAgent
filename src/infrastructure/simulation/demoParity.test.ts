// Temporary parity check: the standalone demo engine (web/lib/demo/cirEngine.ts)
// must reproduce the bot's LocalCIREngine output for identical inputs.
import { describe, expect, it, vi } from 'vitest';
import { LocalCIREngine } from './LocalCIREngine.js';
import { runCIRSimulation } from '../../../web/lib/demo/cirEngine.js';

vi.mock('../../config/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('demo engine parity with LocalCIREngine', () => {
  const cases = [
    { rainSeries: [0,0,1.2,3.5,8,12.1,4.2,0.5,0,0,2.1,6.6,15.2,9.9,3.3,0,0,0,1.1,0.2,0,0,0,0],
      terrain: { slope: 22, twi: 8.5, lithology: 'volcanic ash', soil: 'andosol' },
      humidityPct: 82, temperatureC: 18, S0: 0.45, nSimulations: 2000, seed: 42 },
    { rainSeries: new Array(24).fill(0.5),
      terrain: { slope: 5, twi: 3, lithology: 'granite', soil: 'clay' },
      humidityPct: 60, temperatureC: 24, S0: 0.3, nSimulations: 1500, seed: 7 },
    { rainSeries: [20,25,30,28,22,18,10,5,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      terrain: { slope: 35, twi: 12, lithology: 'weak ash', soil: 'volcanic' },
      humidityPct: 95, temperatureC: 15, S0: 0.6, nSimulations: 3000, seed: 99 },
  ];

  it.each(cases)('matches for seed $seed', async (tc) => {
    const ported = runCIRSimulation({
      rainSeries: tc.rainSeries, dtHours: 1, terrain: tc.terrain,
      humidityPct: tc.humidityPct, temperatureC: tc.temperatureC,
      S0: tc.S0, nSimulations: tc.nSimulations, seed: tc.seed,
    });
    const orig = await new LocalCIREngine().simulate({
      precipitation_mm: tc.rainSeries.reduce((a, b) => a + b, 0),
      humidity_pct: tc.humidityPct, temperature_c: tc.temperatureC,
      n_simulations: tc.nSimulations, time_horizon_hours: 24,
      S0: tc.S0, seed: tc.seed, rain_series: tc.rainSeries, dt_hours: 1,
      site: { id: 't', name: 't', latitude: 6.25, longitude: -75.56, covariates: tc.terrain } as never,
    });
    expect(ported.risk_probability).toBe(orig.risk_probability);
    expect(ported.mean_saturation).toBe(orig.mean_saturation);
    expect(ported.std_saturation).toBe(orig.std_saturation);
    expect(ported.s_q_high).toBe(orig.S_q_high);
    expect(ported.alert_level).toBe(orig.alert_level);
  });
});
