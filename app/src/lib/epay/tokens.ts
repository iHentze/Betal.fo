import type { AccessToken, Environment } from "./types";

/**
 * Minimal slice of the Workers KV API, declared locally so this module can be unit
 * tested without the Workers runtime.
 */
export interface TokenStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CachedToken {
  accessToken: string;
  /** Unix milliseconds. */
  expiresAtMs: number;
}

/**
 * Refresh this far ahead of the stated expiry. ePay warns about "inflight clock skew
 * issues", so a token is treated as expired before it actually is.
 */
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Never cache longer than this. ePay caches token *requests* for an hour, so asking
 * again inside that window returns the same token anyway — but holding our copy for
 * less than the hour means a token revoked upstream falls out of our cache promptly.
 */
const MAX_CACHE_MS = 50 * 60 * 1000;

export function cacheKey(accountId: string, environment: Environment): string {
  return `epay:token:${environment}:${accountId}`;
}

/**
 * Caches merchant access tokens per (account, environment).
 *
 * Tokens live 8 hours and are a full substitute for the merchant API key, so they are
 * treated as secrets: stored only in KV, never logged, and never returned to a browser.
 */
export class AccessTokenCache {
  constructor(
    private readonly store: TokenStore,
    private readonly mint: (
      accountId: string,
      environment: Environment,
    ) => Promise<AccessToken>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(accountId: string, environment: Environment): Promise<string> {
    const key = cacheKey(accountId, environment);
    const cached = await this.store.get(key);

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CachedToken;
        if (parsed.expiresAtMs - SAFETY_MARGIN_MS > this.now()) {
          return parsed.accessToken;
        }
      } catch {
        // Corrupt entry; fall through and mint a fresh token.
      }
    }

    const minted = await this.mint(accountId, environment);
    const expiresAtMs = Date.parse(minted.expiresAt);

    const record: CachedToken = {
      accessToken: minted.accessToken,
      // If ePay ever sends an unparseable date, assume the documented 8 hours.
      expiresAtMs: Number.isFinite(expiresAtMs)
        ? expiresAtMs
        : this.now() + 8 * 60 * 60 * 1000,
    };

    const lifetimeMs = record.expiresAtMs - SAFETY_MARGIN_MS - this.now();
    const ttlSeconds = Math.floor(Math.min(lifetimeMs, MAX_CACHE_MS) / 1000);

    if (ttlSeconds > 60) {
      // KV rejects TTLs under 60 seconds; a token that short-lived is not worth caching.
      await this.store.put(key, JSON.stringify(record), {
        expirationTtl: ttlSeconds,
      });
    }

    return record.accessToken;
  }

  /** Drop a cached token, for use after a 401 suggests it was revoked upstream. */
  async invalidate(accountId: string, environment: Environment): Promise<void> {
    await this.store.delete(cacheKey(accountId, environment));
  }
}
