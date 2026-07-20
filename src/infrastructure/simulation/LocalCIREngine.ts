// ---
// 📚 WHY: Provides a local CIR engine in TypeScript as a fallback for the Python service.
//    If the FastAPI microservice is down or unreachable, the bot must not become useless.
//    This fallback preserves the same core logic (Euler-Maruyama + Monte Carlo) to
//    maintain operational continuity without inventing data or degrading to static rules.
// 📁 FILE: src/infrastructure/simulation/LocalCIREngine.ts
// ---

import type {
  CIRSimulationInput,
  CIRSimulationOutput,
  ISimulationEngine,
} from '../../domain/ports/ISimulationEngine.js';
import { logger } from '../../config/logger.js';
import {
  describeAlertAnchoring,
  normalizeJacobiInput,
  roundJacobiResult,
} from './jacobiModel.js';

export class LocalCIREngine implements ISimulationEngine {
  async simulate(input: CIRSimulationInput): Promise<CIRSimulationOutput> {
    const startTime = Date.now();
    const normalized = normalizeJacobiInput(input);

    const steps = normalized.rainSeries.length;
    const dtDays = normalized.dtHours / 24;
    const sqrtDt = Math.sqrt(dtDays);
    const saturations = new Float64Array(normalized.nSimulations).fill(normalized.S0);
    const peakSaturation = new Float64Array(normalized.nSimulations).fill(normalized.S0);
    const hazardIntegrals = new Float64Array(normalized.nSimulations).fill(0);
    const rng = new DeterministicNormalGenerator(normalized.seed);

    for (let step = 0; step < steps; step += 1) {
      const rainfall = normalized.rainSeries[step] ?? 0;
      const rho = 1 - Math.exp(-(rainfall / Math.max(normalized.dtHours, 1e-9)) / 12);
      const { kappa, lambda, sigma, h0, beta, criticalSaturation } = normalized.terrain;

      for (let simIndex = 0; simIndex < normalized.nSimulations; simIndex += 1) {
        const current = saturations[simIndex] ?? normalized.S0;
        const drift = (kappa * rho * (1 - current) - lambda * current) * dtDays;
        const diffusion = sigma * Math.sqrt(Math.max(current * (1 - current), 0)) * sqrtDt * rng.next();
        const next = this.numericSafeguardUnitInterval(current + drift + diffusion);
        saturations[simIndex] = next;
        if (next > (peakSaturation[simIndex] ?? next)) {
          peakSaturation[simIndex] = next;
        }

        const hazard = h0 * Math.exp(beta * Math.max(next - criticalSaturation, 0));
        hazardIntegrals[simIndex] = (hazardIntegrals[simIndex] ?? 0) + hazard * dtDays;
      }
    }

    const failureCount = peakSaturation.filter(
      (value) => value > normalized.terrain.criticalSaturation
    ).length;
    const pathFailureProbabilities = hazardIntegrals.map((value) => 1 - Math.exp(-value));
    const result = roundJacobiResult({
      probFailure: failureCount / normalized.nSimulations,
      SMean: this.mean(peakSaturation),
      SStd: this.std(peakSaturation, this.mean(peakSaturation)),
      SQHigh: this.quantile(peakSaturation, 0.95),
      hazardProbabilityMean: this.mean(pathFailureProbabilities),
    });

    const a25AnchorBand = describeAlertAnchoring(normalized.totalRainfallMm);

    const elapsed = Date.now() - startTime;
    logger.warn(
      {
        elapsed_ms: elapsed,
        n_simulations: normalized.nSimulations,
        risk_probability: result.risk_probability,
        alert_level: result.alert_level,
        model_version: result.model_version,
        a25_anchor_band: a25AnchorBand,
      },
      'Using local stochastic fallback engine with Jacobi rainfall-forced hazard model'
    );

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private numericSafeguardUnitInterval(value: number): number {
    // Numeric safeguard only: absorbs floating-point / discretization leakage at the boundaries.
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  private mean(values: ArrayLike<number>): number {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[index] ?? 0;
    }
    return sum / values.length;
  }

  private std(values: ArrayLike<number>, mean: number): number {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index] ?? 0;
      sum += (value - mean) ** 2;
    }
    const variance = sum / values.length;
    return Math.sqrt(variance);
  }

  private quantile(values: ArrayLike<number>, q: number): number {
    const sorted = Array.from(values).sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
  }
}

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
