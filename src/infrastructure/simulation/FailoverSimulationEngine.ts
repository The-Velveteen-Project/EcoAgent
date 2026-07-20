// ---
// 📚 WHY: Wraps the Python engine with a local fallback for operational continuity.
//    The bot should prefer the Python service for observability and isolation, but if
//    that service goes down, the user should not be left without `/clima`. This wrapper changes
//    only the infrastructure failure point, not the domain contract.
// 📁 FILE: src/infrastructure/simulation/FailoverSimulationEngine.ts
// ---

import type {
  CIRSimulationInput,
  CIRSimulationOutput,
  ISimulationEngine,
} from '../../domain/ports/ISimulationEngine.js';
import {
  SimulationRateLimitError,
  SimulationServiceUnavailableError,
  SimulationValidationError,
} from './errors.js';
import { logger } from '../../config/logger.js';

export class FailoverSimulationEngine implements ISimulationEngine {
  constructor(
    private readonly primary: ISimulationEngine,
    private readonly fallback: ISimulationEngine
  ) {}

  async simulate(input: CIRSimulationInput): Promise<CIRSimulationOutput> {
    try {
      return await this.primary.simulate(input);
    } catch (err) {
      const shouldFallback =
        err instanceof SimulationServiceUnavailableError ||
        err instanceof SimulationRateLimitError ||
        err instanceof SimulationValidationError;

      if (!shouldFallback) {
        throw err;
      }

      logger.warn({ err }, 'Primary simulation engine failed; using fallback engine');
      return this.fallback.simulate(input);
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.primary.healthCheck();
  }
}
