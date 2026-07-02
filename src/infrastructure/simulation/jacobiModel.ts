import type { AlertLevel, CIRSimulationInput, CIRSimulationOutput } from '../../domain/ports/ISimulationEngine.js';

export const JACOBI_MODEL_VERSION = 'jacobi_rainfall_forced_v2';
const HOURS_PER_DAY = 24;
const EPSILON = 1e-9;
const A25_ALERT_ANCHORS_MM = {
  LOW_MEDIUM: 200,
  MEDIUM_HIGH: 300,
  HIGH_CRITICAL: 400,
} as const;

interface TerrainParams {
  readonly kappa: number;
  readonly lambda: number;
  readonly sigma: number;
  readonly h0: number;
  readonly beta: number;
  readonly criticalSaturation: number;
}

export interface NormalizedJacobiInput {
  readonly S0: number;
  readonly seed: number;
  readonly nSimulations: number;
  readonly dtHours: number;
  readonly rainSeries: readonly number[];
  readonly humidityPct: number;
  readonly temperatureC: number;
  readonly terrain: TerrainParams;
  readonly totalRainfallMm: number;
}

export interface JacobiSimulationResult extends CIRSimulationOutput {
  readonly prob_failure: number;
  readonly S_mean: number;
  readonly S_std: number;
  readonly S_q_high: number;
  readonly hazard_probability_mean: number;
  readonly model_version: string;
}

/**
 * Legacy callers may still send only accumulated precipitation.
 * This adapter expands that scalar into a flat rain series so rainfall still enters the
 * physics as a temporal forcing, never as a shifted equilibrium term.
 */
export function normalizeJacobiInput(input: CIRSimulationInput): NormalizedJacobiInput {
  const dtHoursFromInput = input.dt_hours ?? 1;
  const rainSeries =
    input.rain_series && input.rain_series.length > 0
      ? input.rain_series
      : buildLegacyFlatRainSeries(input.precipitation_mm, input.time_horizon_hours, dtHoursFromInput);

  const dtHours = input.dt_hours ?? input.time_horizon_hours / rainSeries.length;
  const S0 = input.S0 ?? 0.5;
  const seed = input.seed ?? 1;
  const terrain = deriveTerrainParams(input);

  return {
    S0,
    seed: seed >>> 0,
    nSimulations: input.n_simulations,
    dtHours,
    rainSeries,
    humidityPct: input.humidity_pct,
    temperatureC: input.temperature_c,
    terrain,
    totalRainfallMm: rainSeries.reduce((sum, value) => sum + value, 0),
  };
}

export function buildLegacyFlatRainSeries(
  precipitationMm: number,
  timeHorizonHours: number,
  dtHours: number
): readonly number[] {
  const steps = Math.max(1, Math.round(timeHorizonHours / Math.max(dtHours, EPSILON)));
  const perStepRain = precipitationMm / steps;
  return Array.from({ length: steps }, () => perStepRain);
}

export function mapAlertLevel(probFailure: number): AlertLevel {
  // A25 anchors from MODEL_CARD.md §4:
  // 200 mm -> LOW/MEDIUM boundary region
  // 300 mm -> MEDIUM/HIGH
  // 400 mm -> HIGH/CRITICAL
  // Until backtest calibration exists in-repo, we preserve the corresponding exceedance bands.
  if (probFailure >= 0.7) return 'CRITICAL';
  if (probFailure >= 0.4) return 'HIGH';
  if (probFailure >= 0.15) return 'MEDIUM';
  return 'LOW';
}

export function describeAlertAnchoring(totalRainfallMm: number): keyof typeof A25_ALERT_ANCHORS_MM | 'BELOW_A25' {
  if (totalRainfallMm >= A25_ALERT_ANCHORS_MM.HIGH_CRITICAL) return 'HIGH_CRITICAL';
  if (totalRainfallMm >= A25_ALERT_ANCHORS_MM.MEDIUM_HIGH) return 'MEDIUM_HIGH';
  if (totalRainfallMm >= A25_ALERT_ANCHORS_MM.LOW_MEDIUM) return 'LOW_MEDIUM';
  return 'BELOW_A25';
}

export function roundJacobiResult(result: {
  readonly probFailure: number;
  readonly SMean: number;
  readonly SStd: number;
  readonly SQHigh: number;
  readonly hazardProbabilityMean: number;
}): JacobiSimulationResult {
  const probFailure = Number(result.probFailure.toFixed(4));
  const SMean = Number(result.SMean.toFixed(4));
  const SStd = Number(result.SStd.toFixed(4));
  const SQHigh = Number(result.SQHigh.toFixed(4));
  const hazardProbabilityMean = Number(result.hazardProbabilityMean.toFixed(4));
  const alertLevel = mapAlertLevel(probFailure);

  return {
    prob_failure: probFailure,
    S_mean: SMean,
    S_std: SStd,
    S_q_high: SQHigh,
    hazard_probability_mean: hazardProbabilityMean,
    model_version: JACOBI_MODEL_VERSION,
    // Legacy aliases preserved for backward compatibility.
    risk_probability: probFailure,
    mean_saturation: SMean,
    std_saturation: SStd,
    alert_level: alertLevel,
  };
}

function deriveTerrainParams(input: CIRSimulationInput): TerrainParams {
  const covariates = input.site?.covariates;

  const slope = covariates?.slope ?? null;
  const twi = covariates?.twi ?? null;
  const lithology = covariates?.lithology?.toLowerCase() ?? null;
  const soil = covariates?.soil?.toLowerCase() ?? null;

  let kappa = 0.32;
  if (soil?.includes('andosol') || soil?.includes('volcan')) kappa += 0.05;
  if (lithology?.includes('volcan')) kappa += 0.03;

  let lambda = 0.10;
  if (typeof slope === 'number') lambda += Math.min(Math.max(slope / 200, 0), 0.12);
  if (typeof twi === 'number') lambda += Math.min(Math.max(twi / 100, 0), 0.08);
  lambda += Math.max(input.temperature_c, 0) / 400;

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
