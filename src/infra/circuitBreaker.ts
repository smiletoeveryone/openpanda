/**
 * Circuit breaker per LLM provider.
 * States: closed → open (5 consecutive failures) → half-open (after 30s) → closed (2 successes).
 */

export class CircuitOpenError extends Error {
  constructor(readonly breakerName: string) {
    super(`Circuit breaker open for provider: ${breakerName}`);
    this.name = "CircuitOpenError";
  }
}

type CBState = "closed" | "open" | "half-open";

const FAILURE_THRESHOLD = 5;
const SUCCESS_THRESHOLD = 2;
const COOLDOWN_MS = 30_000;

export class CircuitBreaker {
  readonly name: string;
  private _state: CBState = "closed";
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  constructor(name: string) {
    this.name = name;
  }

  get state(): CBState {
    if (this._state === "open" && Date.now() - this.openedAt >= COOLDOWN_MS) {
      this._state = "half-open";
      this.successes = 0;
    }
    return this._state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      this.onFailure();
      throw err;
    }
  }

  reset(): void {
    this._state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.openedAt = 0;
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this._state === "half-open") {
      this.successes++;
      if (this.successes >= SUCCESS_THRESHOLD) {
        this._state = "closed";
        this.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.successes = 0;
    if (this._state === "half-open") {
      this._state = "open";
      this.openedAt = Date.now();
      return;
    }
    this.failures++;
    if (this.failures >= FAILURE_THRESHOLD) {
      this._state = "open";
      this.openedAt = Date.now();
    }
  }
}

const registry = new Map<string, CircuitBreaker>();

export function getProviderCircuitBreaker(provider: string): CircuitBreaker {
  if (!registry.has(provider)) {
    registry.set(provider, new CircuitBreaker(provider));
  }
  return registry.get(provider)!;
}
