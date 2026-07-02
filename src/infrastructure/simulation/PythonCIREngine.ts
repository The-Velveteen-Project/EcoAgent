// ---
// 📚 POR QUÉ: Implementa ISimulationEngine como cliente HTTP al motor Python CIR.
//    Valida la respuesta con Zod en runtime para detectar contratos rotos entre
//    TypeScript y Python inmediatamente (no en runtime caótico horas después).
//    Timeout de 30s porque simulaciones Monte Carlo pueden ser lentas con n=10000.
// 📁 ARCHIVO: src/infrastructure/simulation/PythonCIREngine.ts
// ---

import axios, { AxiosError, type AxiosInstance } from 'axios';
import {
  type ISimulationEngine,
  type CIRSimulationInput,
  type CIRSimulationOutput,
  CIRSimulationOutputSchema,
} from '../../domain/ports/ISimulationEngine.js';
import {
  SimulationServiceUnavailableError,
  SimulationValidationError,
  SimulationRateLimitError,
} from './errors.js';
import { logger } from '../../config/logger.js';

export class PythonCIREngine implements ISimulationEngine {
  private readonly client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/simulate_risk$/, ''),
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async simulate(input: CIRSimulationInput): Promise<CIRSimulationOutput> {
    const startTime = Date.now();

    try {
      const response = await this.client.post('/simulate_risk', {
        precipitation_mm: input.precipitation_mm,
        humidity_pct: input.humidity_pct,
        temperature_c: input.temperature_c,
        n_simulations: input.n_simulations,
        time_horizon_hours: input.time_horizon_hours,
        S0: input.S0,
        rain_series: input.rain_series,
        dt_hours: input.dt_hours,
        seed: input.seed,
        site_id: input.site_id,
        site: input.site,
      });

      // Validate response against Zod schema — catches contract mismatches
      const parsed = CIRSimulationOutputSchema.safeParse(response.data);

      if (!parsed.success) {
        logger.error(
          { err: parsed.error, input, rawResponse: response.data },
          'Python engine response failed Zod validation'
        );
        throw new SimulationValidationError(
          `Simulation response schema mismatch: ${parsed.error.message}`,
          parsed.error
        );
      }

      const elapsed = Date.now() - startTime;
      logger.info(
        { elapsed_ms: elapsed, alert_level: parsed.data.alert_level },
        'CIR simulation completed'
      );

      return parsed.data;
    } catch (err: unknown) {
      // Re-throw our own typed errors
      if (
        err instanceof SimulationValidationError ||
        err instanceof SimulationRateLimitError ||
        err instanceof SimulationServiceUnavailableError
      ) {
        throw err;
      }

      if (err instanceof AxiosError) {
        // HTTP 429 — rate limited
        if (err.response?.status === 429) {
          logger.error({ err, input }, 'Simulation engine rate-limited (429)');
          throw new SimulationRateLimitError(
            'Simulation engine rate limit exceeded',
            err.response.headers['retry-after']
              ? parseInt(err.response.headers['retry-after'] as string, 10) * 1000
              : undefined
          );
        }

        // Connection refused or timeout
        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED') {
          const fullUrl = `${this.client.defaults.baseURL}/simulate_risk`;
          logger.error(
            { err, input, targetUrl: fullUrl },
            `Simulation engine unreachable at ${fullUrl}. Check if the engine is running and the PYTHON_API_URL is correct.`
          );
          throw new SimulationServiceUnavailableError(
            `Simulation engine unreachable at ${fullUrl}: ${err.code}`,
            err
          );
        }
      }

      // Unknown error — wrap as unavailable
      logger.error({ err, input }, 'Unexpected simulation error');
      throw new SimulationServiceUnavailableError(
        `Unexpected simulation error: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
