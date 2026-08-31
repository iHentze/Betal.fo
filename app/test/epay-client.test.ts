import { describe, expect, it, vi } from "vitest";
import { EpayHttpClient, RateLimiter } from "~/lib/epay/http";
import {
  EpayAuthError,
  EpayRateLimitError,
  EpayValidationError,
} from "~/lib/epay/errors";
import { AccessTokenCache, cacheKey, type TokenStore } from "~/lib/epay/tokens";
import { EpayMerchantClient } from "~/lib/epay/merchant";
import type { Transaction } from "~/lib/epay/types";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** In-memory KV double. */
function memoryStore(): TokenStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

const noSleep = async () => {};

describe("EpayHttpClient", () => {
  it("sends the bearer credential and parses the body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { account: { id: "a1" } }));
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    const result = await client.request<{ account: { id: string } }>(
      "Bearer partner-key",
      "/partner/accounts/a1",
    );

    expect(result.data.account.id).toBe("a1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://payments.epay.eu/public/api/v1/partner/accounts/a1");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer partner-key",
    );
  });

  it("omits empty query params and repeats array params", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    await client.request("Bearer k", "/transactions/operations", {
      query: {
        page: 1,
        offset: "",
        missing: undefined,
        pointOfSaleId: ["pos-1", "pos-2"],
      },
    });

    const url = fetchMock.mock.calls[0]![0];
    expect(url).toContain("page=1");
    expect(url).not.toContain("offset=");
    expect(url).not.toContain("missing");
    expect(url).toContain("pointOfSaleId=pos-1&pointOfSaleId=pos-2");
  });

  it("attaches the Idempotency-Key and reports a replay", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true }, { "idempotent-replayed": "true" }),
    );
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    const result = await client.request("Bearer k", "/transactions/t1/capture", {
      method: "POST",
      body: { amount: 100 },
      idempotencyKey: "key-123",
    });

    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-123");
    expect(result.idempotentReplay).toBe(true);
  });

  it("honours Retry-After on 429 rather than guessing a backoff", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { errorCode: "RATE_LIMIT_REACHED" }, { "retry-after": "7" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const client = new EpayHttpClient({
      fetch: fetchMock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await client.request("Bearer k", "/transactions");

    expect(sleeps).toEqual([7000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx and gives up with the last error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { errorCode: "SERVER_ERROR" }));
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    await expect(
      client.request("Bearer k", "/transactions", { maxRetries: 2 }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 4xx that would just fail again", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(403, { errorCode: "UNAUTHORIZED", message: "Not allowed" }),
    );
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    await expect(client.request("Bearer k", "/partner/accounts")).rejects.toBeInstanceOf(
      EpayAuthError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces 422 field errors", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(422, {
        errorCode: "VALIDATION_ERROR",
        message: "Input validation errors",
        errors: { amount: ["[required]: Is a required non-nullable field"] },
      }),
    );
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    const error = await client
      .request("Bearer k", "/cit", { method: "POST", body: {} })
      .catch((e) => e);

    expect(error).toBeInstanceOf(EpayValidationError);
    expect((error as EpayValidationError).fields.amount).toHaveLength(1);
  });

  it("treats an empty 200 body as success", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const client = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });

    const result = await client.request("Bearer k", "/partner/accounts/a1/activate", {
      method: "PATCH",
    });
    expect(result.data).toBeUndefined();
  });
});

describe("RateLimiter", () => {
  it("allows the burst then paces at the refill interval", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(
      3,
      5000,
      () => now,
      async (ms) => {
        slept.push(ms);
        now += ms;
      },
    );

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(slept).toEqual([]);

    await limiter.acquire();
    expect(slept).toEqual([5000]);
  });

  it("refills over time up to the burst capacity", async () => {
    let now = 0;
    const limiter = new RateLimiter(3, 5000, () => now, noSleep);

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.available).toBe(1);

    now += 20_000;
    expect(limiter.available).toBe(3);
  });
});

describe("AccessTokenCache", () => {
  const hour = 60 * 60 * 1000;

  it("mints once and serves the cached token afterwards", async () => {
    const store = memoryStore();
    let now = 0;
    const mint = vi.fn(async () => ({
      accessToken: "jwt-1",
      expiresAt: new Date(now + 8 * hour).toISOString(),
    }));
    const cache = new AccessTokenCache(store, mint, () => now);

    expect(await cache.get("acct-1", "live")).toBe("jwt-1");
    expect(await cache.get("acct-1", "live")).toBe("jwt-1");
    expect(mint).toHaveBeenCalledTimes(1);
    expect(store.map.has(cacheKey("acct-1", "live"))).toBe(true);
  });

  it("keeps test and live tokens separate", async () => {
    const store = memoryStore();
    const mint = vi.fn(async (_id: string, environment: string) => ({
      accessToken: `jwt-${environment}`,
      expiresAt: new Date(Date.now() + 8 * hour).toISOString(),
    }));
    const cache = new AccessTokenCache(store, mint);

    expect(await cache.get("acct-1", "live")).toBe("jwt-live");
    expect(await cache.get("acct-1", "test")).toBe("jwt-test");
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("re-mints before expiry so a token is never used at the boundary", async () => {
    const store = memoryStore();
    let now = 0;
    let issued = 0;
    const mint = vi.fn(async () => {
      issued += 1;
      return {
        accessToken: `jwt-${issued}`,
        expiresAt: new Date(now + 8 * hour).toISOString(),
      };
    });
    const cache = new AccessTokenCache(store, mint, () => now);

    expect(await cache.get("acct-1", "live")).toBe("jwt-1");

    // Four minutes before the stated expiry: inside the safety margin, so re-mint.
    now += 8 * hour - 4 * 60 * 1000;
    expect(await cache.get("acct-1", "live")).toBe("jwt-2");
  });

  it("re-mints when the cached entry is corrupt", async () => {
    const store = memoryStore();
    store.map.set(cacheKey("acct-1", "live"), "not json");
    const mint = vi.fn(async () => ({
      accessToken: "jwt-fresh",
      expiresAt: new Date(Date.now() + 8 * hour).toISOString(),
    }));
    const cache = new AccessTokenCache(store, mint);

    expect(await cache.get("acct-1", "live")).toBe("jwt-fresh");
  });
});

describe("EpayMerchantClient", () => {
  function transaction(id: string): Transaction {
    return {
      id,
      subscriptionId: null,
      billingAgreementChargeId: null,
      state: "SUCCESS",
      errorCode: null,
      externalStatusCodes: null,
      createdAt: "2026-08-01T10:00:00Z",
      sessionId: "s1",
      paymentMethodId: "pm1",
      paymentMethodType: "CARD",
      paymentMethodSubType: "Visa",
      paymentMethodExpiry: null,
      paymentMethodDisplayText: "40000000XXXX0003",
      paymentMethodHolderName: null,
      scaMode: "NORMAL",
      customerId: null,
      amount: 10_00,
      fee: 0,
      currency: "DKK",
      instantCapture: "OFF",
      notificationUrl: "https://app.betal.fo/hooks",
      pointOfSaleId: "pos1",
      reference: null,
      textOnStatement: null,
      exemptions: [],
      attributes: {},
      clientIp: "",
      clientCountry: "FO",
      type: "PAYMENT",
    };
  }

  it("walks every cursor page and reports each new offset", async () => {
    const pages = [
      {
        currentOffset: "",
        nextOffset: "CUR2",
        perPage: 2,
        hasMore: true,
        items: [{ transaction: transaction("T1") }, { transaction: transaction("T2") }],
      },
      {
        currentOffset: "CUR2",
        nextOffset: null,
        perPage: 2,
        hasMore: false,
        items: [{ transaction: transaction("T3") }],
      },
    ];

    let call = 0;
    const fetchMock = vi.fn(async () => jsonResponse(200, pages[call++]));
    const http = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });
    const client = new EpayMerchantClient(http, async () => "Bearer token");

    const seen: string[] = [];
    const offsets: (string | null)[] = [];
    for await (const tx of client.iterateTransactions({}, undefined, async (next) => {
      offsets.push(next);
    })) {
      seen.push(tx.id);
    }

    expect(seen).toEqual(["T1", "T2", "T3"]);
    expect(offsets).toEqual(["CUR2", null]);
    expect(fetchMock.mock.calls[1]![0]).toContain("offset=CUR2");
  });

  it("resumes from a persisted cursor", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        currentOffset: "SAVED",
        nextOffset: null,
        perPage: 500,
        hasMore: false,
        items: [{ transaction: transaction("T9") }],
      }),
    );
    const http = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });
    const client = new EpayMerchantClient(http, async () => "Bearer token");

    const seen: string[] = [];
    for await (const tx of client.iterateTransactions({}, "SAVED")) seen.push(tx.id);

    expect(seen).toEqual(["T9"]);
    expect(fetchMock.mock.calls[0]![0]).toContain("offset=SAVED");
  });

  it("sends an idempotency key on every money operation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { operationId: "op1", success: true, state: "SUCCESS" }),
    );
    const http = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });
    const client = new EpayMerchantClient(http, async () => "Bearer token");

    await client.capture("T1", 500, "idem-capture");
    await client.void("T1", -1, "idem-void");

    for (const call of fetchMock.mock.calls) {
      const headers = call[1]!.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBeTruthy();
    }
  });

  it("surfaces a failed operation that ePay returned with HTTP 200", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        operationId: "op1",
        success: false,
        state: "FAILED",
        errorCode: {
          code: "DECLINED_BY_ISSUER_OR_SCHEME",
          message: "The operation was rejected",
        },
      }),
    );
    const http = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });
    const client = new EpayMerchantClient(http, async () => "Bearer token");

    const result = await client.capture("T1", 500, "idem-1");
    expect(result.success).toBe(false);
    expect(result.errorCode?.code).toBe("DECLINED_BY_ISSUER_OR_SCHEME");
  });

  it("resolves the token lazily on each call so refreshes are picked up", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    const http = new EpayHttpClient({ fetch: fetchMock, sleep: noSleep });
    let issued = 0;
    const client = new EpayMerchantClient(http, async () => `Bearer jwt-${++issued}`);

    await client.listPointsOfSale();
    await client.listPointsOfSale();

    const first = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    const second = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(first.Authorization).toBe("Bearer jwt-1");
    expect(second.Authorization).toBe("Bearer jwt-2");
  });
});

describe("EpayRateLimitError", () => {
  it("is retryable and carries the wait hint", () => {
    const error = new EpayRateLimitError("Too many requests", 12);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(12);
  });
});
