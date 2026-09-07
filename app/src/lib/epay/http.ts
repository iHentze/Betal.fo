import {
  EpayRateLimitError,
  EpayTimeoutError,
  errorFromResponse,
  type EpayErrorBody,
} from "./errors";

export const EPAY_BASE_URL = "https://payments.epay.eu";
export const EPAY_API_PREFIX = "/public/api/v1";

/**
 * Per-request timeouts. ePay documents different recommended minimums per endpoint
 * class: 5s for session init and async payouts, 10s for MIT batch, 60s for the
 * synchronous money operations.
 */
export const TIMEOUTS = {
  default: 15_000,
  session: 5_000,
  batch: 10_000,
  operation: 60_000,
} as const;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  /** Sent as Idempotency-Key. ePay caches the response for 24 hours. */
  idempotencyKey?: string | undefined;
  timeoutMs?: number;
  /** Retries on 429 and 5xx only. Never on 4xx, which would just fail again. */
  maxRetries?: number;
  signal?: AbortSignal | undefined;
}

export interface EpayResponse<T> {
  data: T;
  /** True when ePay replayed a cached response for our Idempotency-Key. */
  idempotentReplay: boolean;
  rateLimit: RateLimitInfo | undefined;
}

export interface RateLimitInfo {
  limit: number | undefined;
  remaining: number | undefined;
  /** Unix seconds. */
  reset: number | undefined;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  /** Injected so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each attempt; lets a shared limiter throttle index endpoints. */
  beforeRequest?: (path: string) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      // ePay expects repeated params rather than a comma-joined list.
      for (const entry of value) {
        if (entry !== undefined && entry !== null) params.append(key, String(entry));
      }
    } else {
      params.append(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function readRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit === null && remaining === null && reset === null) return undefined;
  const toNumber = (raw: string | null) => {
    if (raw === null) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    limit: toNumber(limit),
    remaining: toNumber(remaining),
    reset: toNumber(reset),
  };
}

/**
 * Backoff for a retryable failure. On 429 we honour ePay's Retry-After rather than
 * guessing, since their index limiter refills on a fixed schedule.
 */
function backoffMs(attempt: number, error: unknown): number {
  if (error instanceof EpayRateLimitError && error.retryAfterSeconds !== undefined) {
    return Math.max(error.retryAfterSeconds * 1000, 1000);
  }
  const base = Math.min(2 ** attempt * 500, 30_000);
  // Jitter so concurrent workers do not retry in lockstep.
  return base + Math.floor(Math.random() * 250);
}

/**
 * Thin HTTP layer over the ePay API. Holds no credentials: the caller supplies an
 * Authorization value per request, because a partner key and a merchant access token
 * are used against the same host.
 */
export class EpayHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly beforeRequest: ((path: string) => Promise<void>) | undefined;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? EPAY_BASE_URL;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.beforeRequest = options.beforeRequest;
  }

  async request<T>(
    authorization: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<EpayResponse<T>> {
    const {
      method = "GET",
      query,
      body,
      idempotencyKey,
      timeoutMs = TIMEOUTS.default,
      maxRetries = 3,
    } = options;

    const url = `${this.baseUrl}${EPAY_API_PREFIX}${path}${buildQuery(query)}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (this.beforeRequest) await this.beforeRequest(path);

      try {
        return await this.attempt<T>(
          authorization,
          url,
          path,
          method,
          body,
          idempotencyKey,
          timeoutMs,
          options.signal,
        );
      } catch (error) {
        lastError = error;

        const isRetryable =
          (error instanceof Error && error.name === "EpayRateLimitError") ||
          (error instanceof Error &&
            "retryable" in error &&
            (error as { retryable: boolean }).retryable) ||
          error instanceof EpayTimeoutError;

        if (!isRetryable || attempt === maxRetries) throw error;
        await this.sleep(backoffMs(attempt, error));
      }
    }

    throw lastError;
  }

  private async attempt<T>(
    authorization: string,
    url: string,
    path: string,
    method: string,
    body: unknown,
    idempotencyKey: string | undefined,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<EpayResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new EpayTimeoutError(timeoutMs, path);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const rateLimit = readRateLimit(response.headers);
    const idempotentReplay = response.headers.get("idempotent-replayed") === "true";

    const text = await response.text();
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!response.ok) {
      throw errorFromResponse(
        response.status,
        parsed as EpayErrorBody | undefined,
        response.headers,
      );
    }

    return {
      // Several endpoints return 200 with an empty body; callers type those as void.
      data: (parsed ?? undefined) as T,
      idempotentReplay,
      rateLimit,
    };
  }
}

/**
 * Token bucket matching ePay's documented index-endpoint limit of 1 request per 5
 * seconds with a burst of 30. Used by the backfill and the monthly close so they
 * self-throttle instead of relying on 429s to pace them.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity = 30,
    private readonly refillIntervalMs = 5_000,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = this.refillIntervalMs - (this.now() - this.lastRefill);
    await this.sleep(Math.max(waitMs, 0));
    this.refill();
    this.tokens = Math.max(this.tokens - 1, 0);
  }

  private refill(): void {
    const elapsed = this.now() - this.lastRefill;
    if (elapsed < this.refillIntervalMs) return;
    const earned = Math.floor(elapsed / this.refillIntervalMs);
    this.tokens = Math.min(this.capacity, this.tokens + earned);
    this.lastRefill += earned * this.refillIntervalMs;
  }

  /** Exposed for tests and for reporting remaining budget in the close UI. */
  get available(): number {
    this.refill();
    return this.tokens;
  }
}
