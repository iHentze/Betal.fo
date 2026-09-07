import { EpayHttpClient, RateLimiter, type HttpClientOptions } from "./http";
import { EpayMerchantClient } from "./merchant";
import { EpayPartnerClient } from "./partner";
import { AccessTokenCache, type TokenStore } from "./tokens";
import type { Environment } from "./types";

export * from "./types";
export * from "./errors";
export { EpayHttpClient, RateLimiter, TIMEOUTS } from "./http";
export { EpayPartnerClient } from "./partner";
export { EpayMerchantClient } from "./merchant";
export { AccessTokenCache, type TokenStore } from "./tokens";

export interface EpayConfig {
  partnerKey: string;
  tokens: TokenStore;
  http?: HttpClientOptions;
}

/**
 * Entry point for all ePay access.
 *
 * Holds the partner key and hands out per-merchant clients whose credentials come from
 * the token cache, so nothing above this layer ever handles a raw ePay credential.
 */
export class Epay {
  readonly partner: EpayPartnerClient;
  private readonly http: EpayHttpClient;
  private readonly cache: AccessTokenCache;

  constructor(config: EpayConfig) {
    this.http = new EpayHttpClient(config.http);
    this.partner = new EpayPartnerClient(this.http, config.partnerKey);
    this.cache = new AccessTokenCache(config.tokens, (accountId, environment) =>
      this.partner.createAccessToken(accountId, environment),
    );
  }

  /** A client scoped to one merchant, refreshing its token as needed. */
  forMerchant(accountId: string, environment: Environment): EpayMerchantClient {
    return new EpayMerchantClient(
      this.http,
      async () => `Bearer ${await this.cache.get(accountId, environment)}`,
    );
  }

  /**
   * A merchant client that self-throttles to ePay's index-endpoint budget of one
   * request per five seconds. Use this for backfill and the monthly close; use
   * `forMerchant` for interactive requests, which are single-resource calls under a
   * far more generous limit.
   */
  forMerchantThrottled(
    accountId: string,
    environment: Environment,
    limiter: RateLimiter = new RateLimiter(),
  ): EpayMerchantClient {
    const throttled = new EpayHttpClient({
      beforeRequest: () => limiter.acquire(),
    });
    return new EpayMerchantClient(
      throttled,
      async () => `Bearer ${await this.cache.get(accountId, environment)}`,
    );
  }

  /** Drop a cached token after a 401 suggests it was revoked upstream. */
  async invalidateToken(accountId: string, environment: Environment): Promise<void> {
    await this.cache.invalidate(accountId, environment);
  }
}
