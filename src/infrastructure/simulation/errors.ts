// ---
// 📚 WHY: Define typed errors for the simulation engine instead of generic strings.
//    Without our own error classes, a catch only has "Error" — you can't distinguish whether
//    the service is down (retry with backoff), whether the response is invalid (bug in Python),
//    or whether you're being rate-limited (wait). Each type requires a different strategy.
// 📁 FILE: src/infrastructure/simulation/errors.ts
// ---

/**
 * Thrown when the Python simulation engine is unreachable (ECONNREFUSED, timeout).
 * Recovery strategy: retry with exponential backoff, alert ops.
 */
export class SimulationServiceUnavailableError extends Error {
  public override readonly name = 'SimulationServiceUnavailableError';

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * Thrown when the simulation engine returns a response that doesn't match
 * the expected Zod schema. Indicates a contract mismatch between TS and Python.
 * Recovery strategy: fix the Python engine or update the schema.
 */
export class SimulationValidationError extends Error {
  public override readonly name = 'SimulationValidationError';

  constructor(
    message: string,
    public readonly zodErrors?: unknown
  ) {
    super(message);
  }
}

/**
 * Thrown when the simulation engine returns HTTP 429 (Too Many Requests).
 * Recovery strategy: wait and retry after the indicated backoff period.
 */
export class SimulationRateLimitError extends Error {
  public override readonly name = 'SimulationRateLimitError';

  constructor(
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
  }
}
