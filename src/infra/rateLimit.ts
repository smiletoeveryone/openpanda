/**
 * Sliding-window per-user rate limiter (in-memory).
 * Default: 20 requests per 60 seconds per user/chat ID.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class UserRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly hits = new Map<string, number[]>();

  constructor(config?: { windowMs?: number; maxRequests?: number }) {
    this.windowMs = config?.windowMs ?? 60_000;
    this.maxRequests = config?.maxRequests ?? 20;
  }

  check(userId: number | string): RateLimitResult {
    const key = String(userId);
    const now = Date.now();
    const cutoff = now - this.windowMs;

    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const retryAfterMs = oldest + this.windowMs - now;
      this.hits.set(key, timestamps);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, remaining: this.maxRequests - timestamps.length, retryAfterMs: 0 };
  }

  reset(userId: number | string): void {
    this.hits.delete(String(userId));
  }

  /** Remove stale entries to keep the map from growing unbounded. */
  prune(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const live = timestamps.filter((t) => t > cutoff);
      if (live.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, live);
      }
    }
  }
}
