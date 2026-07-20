// ---
// 📚 WHY: Self-contained CIR (Cox-Ingersoll-Ross) stochastic risk engine for the
//    public /demo page. This is a dependency-free port of the bot's
//    infrastructure/simulation engine (jacobiModel.ts + LocalCIREngine.ts): same
//    rainfall-forced square-root diffusion physics and Euler-Maruyama Monte Carlo,
//    but with no logger, no axios, and no Zod — so it runs inside a Next.js API
//    route (Node or Edge) with zero backend. Keeping it standalone means the demo
//    never touches the Python microservice or the authenticated bot code path.
// 📁 FILE: web/lib/demo/cirEngine.ts
// ---

export type AlertLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Terrain covariates for a monitored site. Drive the site-specific physics. */
export interface TerrainCovariates {
  /** Mean slope in degrees. Steeper → faster drainage but lower critical saturation. */
  readonly slope?: number;
  /** Topographic Wetness Index. Higher → more water accumulation. */
  readonly twi?: number;
  /** Dominant lithology (free text; 'volcanic'/'ash'/'weak' recognized). */
  readonly lithology?: string;
  /** Dominant soil type (free text; 'andosol'/'volcanic' recognized). */
  readonly soil?: string;
}

export interface CIRInput {
  /** Rainfall forcing series (mm per dt_hours bin) across the horizon. */
  readonly rainSeries: readonly number[];
  /** Time step for each rain-series bin, in hours. */
  readonly dtHours: number;
  /** Relative humidity percentage (0–100). */
  readonly humidityPct: number;
  /** Air temperature in Celsius. */
  readonly temperatureC: number;
  /** Initial latent soil-saturation state (0–1). */
  readonly S0?: number;
  /** Number of Monte Carlo paths. */
  readonly nSimulations?: number;
  /** Deterministic seed for reproducibility. */
  readonly seed?: number;
  /** Per-site terrain covariates. */
  readonly terrain?: TerrainCovariates;
}

export interface CIROutput {
  /** Probability of exceeding the critical soil-saturation threshold over the horizon. */
  readonly risk_probability: number;
  /** Mean peak soil saturation across Monte Carlo paths (0–1). */
  readonly mean_saturation: number;
  /** Standard deviation of peak saturation — simulation uncertainty. */
  readonly std_saturation: number;
  /** 95th-percentile peak saturation. */
  readonly s_q_high: number;
  /** Discrete alert level derived from risk_probability. */
  readonly alert_level: AlertLevel;
  /** Total accumulated rainfall over the horizon (mm). */
  readonly total_rainfall_mm: number;
  /**
   * Site-specific critical saturation threshold used by the physics (0.55–0.9).
   * Lower for steeper / weaker terrain — this is what makes failure site-specific.
   * Exposed so callers can compute a saturation index relative to this threshold.
   */
  readonly critical_saturation: number;
  /** Internal model version tag. */
  readonly model_version: string;
}

export const DEMO_MODEL_VERSION = 'jacobi_rainfall_forced_v2_demo';

interface TerrainParams {
  readonly kappa: number;
  readonly lambda: number;
  readonly sigma: number;
  readonly h0: number;
  readonly beta: number;
  readonly criticalSaturation: number;
}

/**
 * Maps terrain covariates + temperature to the physical parameters of the
 * square-root diffusion. Mirrors deriveTerrainParams() in the bot's jacobiModel.ts.
 */
function deriveTerrainParams(
  terrain: TerrainCovariates | undefined,
  temperatureC: number
): TerrainParams {
  const slope = typeof terrain?.slope === 'number' ? terrain.slope : null;
  const twi = typeof terrain?.twi === 'number' ? terrain.twi : null;
  const lithology = terrain?.lithology?.toLowerCase() ?? null;
  const soil = terrain?.soil?.toLowerCase() ?? null;

  let kappa = 0.32;
  if (soil?.includes('andosol') || soil?.includes('volcan')) kappa += 0.05;
  if (lithology?.includes('volcan')) kappa += 0.03;

  let lambda = 0.1;
  if (typeof slope === 'number') lambda += Math.min(Math.max(slope / 200, 0), 0.12);
  if (typeof twi === 'number') lambda += Math.min(Math.max(twi / 100, 0), 0.08);
  lambda += Math.max(temperatureC, 0) / 400;

  let criticalSaturation = 0.78;
  if (typeof slope === 'number') criticalSaturation -= Math.min(Math.max(slope / 300, 0), 0.12);
  if (lithology?.includes('weak') || lithology?.includes('ash')) criticalSaturation -= 0.05;

  return {
    kappa,
    lambda,
    sigma: 0.12,
    h0: 0.015,
    beta: 9,
    criticalSaturation: Math.min(Math.max(criticalSaturation, 0.55), 0.9),
  };
}

/** Discrete alert level from exceedance probability. Mirrors mapAlertLevel(). */
export function mapAlertLevel(probFailure: number): AlertLevel {
  if (probFailure >= 0.7) return 'CRITICAL';
  if (probFailure >= 0.4) return 'HIGH';
  if (probFailure >= 0.15) return 'MEDIUM';
  return 'LOW';
}

/**
 * Deterministic Box-Muller normal generator (LCG-backed) so a given seed +
 * inputs always produce the same result within a run. Mirrors the bot engine.
 */
class DeterministicNormalGenerator {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let u1 = 0;
    let u2 = 0;
    while (u1 <= 0) u1 = this.nextUniform();
    while (u2 <= 0) u2 = this.nextUniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private nextUniform(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

function clampUnit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function mean(values: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i] ?? 0;
  return sum / values.length;
}

function std(values: Float64Array, m: number): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? 0;
    sum += (v - m) ** 2;
  }
  return Math.sqrt(sum / values.length);
}

function quantile(values: Float64Array, q: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
}

/**
 * Runs the rainfall-forced CIR Monte Carlo simulation.
 * Physics (per path, per dt): dS = [κ·ρ·(1−S) − λ·S]·dt + σ·√(S(1−S))·√dt·Z,
 * where ρ is the rainfall-driven forcing for that bin. Exceedance probability is
 * the fraction of paths whose peak saturation crosses the site's critical level.
 */
export function runCIRSimulation(input: CIRInput): CIROutput {
  const rainSeries = input.rainSeries.length > 0 ? input.rainSeries : [0];
  const dtHours = input.dtHours > 0 ? input.dtHours : 1;
  const nSimulations = input.nSimulations ?? 1000;
  const S0 = input.S0 ?? 0.5;
  const seed = (input.seed ?? 1) >>> 0;
  const terrain = deriveTerrainParams(input.terrain, input.temperatureC);

  const dtDays = dtHours / 24;
  const sqrtDt = Math.sqrt(dtDays);
  const saturations = new Float64Array(nSimulations).fill(S0);
  const peakSaturation = new Float64Array(nSimulations).fill(S0);
  const hazardIntegrals = new Float64Array(nSimulations).fill(0);
  const rng = new DeterministicNormalGenerator(seed);

  const { kappa, lambda, sigma, h0, beta, criticalSaturation } = terrain;

  for (let step = 0; step < rainSeries.length; step += 1) {
    const rainfall = rainSeries[step] ?? 0;
    const rho = 1 - Math.exp(-(rainfall / Math.max(dtHours, 1e-9)) / 12);

    for (let simIndex = 0; simIndex < nSimulations; simIndex += 1) {
      const current = saturations[simIndex] ?? S0;
      const drift = (kappa * rho * (1 - current) - lambda * current) * dtDays;
      const diffusion = sigma * Math.sqrt(Math.max(current * (1 - current), 0)) * sqrtDt * rng.next();
      const next = clampUnit(current + drift + diffusion);
      saturations[simIndex] = next;
      if (next > (peakSaturation[simIndex] ?? next)) peakSaturation[simIndex] = next;

      const hazard = h0 * Math.exp(beta * Math.max(next - criticalSaturation, 0));
      hazardIntegrals[simIndex] = (hazardIntegrals[simIndex] ?? 0) + hazard * dtDays;
    }
  }

  let failureCount = 0;
  for (let i = 0; i < peakSaturation.length; i += 1) {
    if ((peakSaturation[i] ?? 0) > criticalSaturation) failureCount += 1;
  }
  const probFailure = failureCount / nSimulations;
  const m = mean(peakSaturation);
  const totalRainfall = rainSeries.reduce((sum, v) => sum + v, 0);

  return {
    risk_probability: Number(probFailure.toFixed(4)),
    mean_saturation: Number(m.toFixed(4)),
    std_saturation: Number(std(peakSaturation, m).toFixed(4)),
    s_q_high: Number(quantile(peakSaturation, 0.95).toFixed(4)),
    alert_level: mapAlertLevel(probFailure),
    total_rainfall_mm: Number(totalRainfall.toFixed(2)),
    critical_saturation: Number(criticalSaturation.toFixed(4)),
    model_version: DEMO_MODEL_VERSION,
  };
}

/**
 * Site-relative soil-saturation index (0–100): how close the modeled peak soil
 * saturation is to THIS site's critical failure threshold. This is the value that
 * differentiates locations for the demo — it combines real-time rainfall (via the
 * simulation) with terrain susceptibility (via the per-site threshold). A value of
 * 100 means the modeled saturation has reached the terrain's failure point.
 */
export function saturationIndex(output: CIROutput): number {
  if (output.critical_saturation <= 0) return 0;
  const idx = (output.s_q_high / output.critical_saturation) * 100;
  return Number(Math.min(Math.max(idx, 0), 100).toFixed(1));
}

/** Alert level from the site-relative saturation index. Demo-calibrated bands. */
export function alertLevelFromIndex(index: number): AlertLevel {
  if (index >= 74) return 'CRITICAL';
  if (index >= 63) return 'HIGH';
  if (index >= 50) return 'MEDIUM';
  return 'LOW';
}
