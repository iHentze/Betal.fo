import { EpayHttpClient, TIMEOUTS } from "./http";
import type {
  AccessToken,
  Account,
  CreateAccountRequest,
  Environment,
  PaginatedResponse,
} from "./types";

/**
 * The partner surface: merchant account lifecycle and access-token minting.
 *
 * Authenticates with the partner key, which is a different credential tier from a
 * merchant API key — a merchant-format key gets 403 here rather than 401.
 */
export class EpayPartnerClient {
  private readonly authorization: string;

  constructor(
    private readonly http: EpayHttpClient,
    partnerKey: string,
  ) {
    this.authorization = `Bearer ${partnerKey}`;
  }

  /**
   * Lists merchant accounts under our partner profile.
   *
   * This endpoint has no filters at all — no search by name, status or domain — so
   * anything selective has to be done against our own mirror.
   */
  async listAccounts(
    page = 1,
    perPage = 100,
  ): Promise<PaginatedResponse<{ account: Account }>> {
    const response = await this.http.request<
      PaginatedResponse<{ account: Account }>
    >(this.authorization, "/partner/accounts", {
      query: { page, perPage },
    });
    return response.data;
  }

  async getAccount(accountId: string): Promise<Account> {
    const response = await this.http.request<{ account: Account }>(
      this.authorization,
      `/partner/accounts/${accountId}`,
    );
    return response.data.account;
  }

  /**
   * Creates a merchant account.
   *
   * Two things worth remembering at the call site: ePay emails an ownership invitation
   * to `email` and there is no way to suppress it, and there is no idempotency support
   * documented on this endpoint, so a retried create risks a duplicate account. Callers
   * should record the returned id before doing anything else.
   */
  async createAccount(request: CreateAccountRequest): Promise<Account> {
    const response = await this.http.request<{ account: Account }>(
      this.authorization,
      "/partner/accounts",
      { method: "POST", body: request },
    );
    return response.data.account;
  }

  /**
   * Marks the account live. Takes no request body — ePay collects no KYC here, because
   * acquiring onboarding happens separately through EasyOnboard, which has no API.
   *
   * Billing begins at this point.
   */
  async activateAccount(accountId: string): Promise<void> {
    await this.http.request<void>(
      this.authorization,
      `/partner/accounts/${accountId}/activate`,
      { method: "PATCH" },
    );
  }

  /** Marks for closing. ePay closes it during the next billing period. */
  async closeAccount(accountId: string): Promise<void> {
    await this.http.request<void>(
      this.authorization,
      `/partner/accounts/${accountId}`,
      { method: "DELETE" },
    );
  }

  /**
   * Mints an access token that stands in for the merchant's API key.
   *
   * Valid 8 hours, and ePay caches the request for 1 hour, so calling this repeatedly
   * inside that window returns the same token. Always go through AccessTokenCache
   * rather than calling this directly.
   */
  async createAccessToken(
    accountId: string,
    environment: Environment,
  ): Promise<AccessToken> {
    const response = await this.http.request<AccessToken>(
      this.authorization,
      `/partner/accounts/${accountId}/access-token`,
      { method: "POST", body: { environment }, timeoutMs: TIMEOUTS.session },
    );
    return response.data;
  }
}
