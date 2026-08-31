import { EpayHttpClient, TIMEOUTS } from "./http";
import type {
  BillingAgreement,
  BillingAgreementCharge,
  BillingPlan,
  CreateBillingAgreementRequest,
  CreateBillingPlanRequest,
  CreatePointOfSaleRequest,
  CreateWebhookRequest,
  CreatedApiKey,
  CursorPaginatedResponse,
  DetailedPointOfSale,
  InitializeSessionRequest,
  ListOperationsQuery,
  ListTransactionsQuery,
  MultiLink,
  Operation,
  OperationResponse,
  PaginatedResponse,
  PaymentLink,
  RefundResponse,
  SessionResponse,
  SettlementTransactionItem,
  SettlementTransfer,
  Subscription,
  TerminalResource,
  Transaction,
  TransactionDetail,
  Webhook,
} from "./types";

/** Resolves the Authorization header value, refreshing the token when needed. */
export type AuthorizationProvider = () => Promise<string>;

/**
 * The merchant surface, acted on behalf of one merchant.
 *
 * The credential behind `auth` is all-or-nothing: the same token that reads a
 * transaction list can issue refunds and payouts. Privilege separation is enforced in
 * our own layer before anything here is called.
 */
export class EpayMerchantClient {
  constructor(
    private readonly http: EpayHttpClient,
    private readonly auth: AuthorizationProvider,
  ) {}

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  /**
   * One page of transactions, newest first.
   *
   * Cursor-paginated with no total count, and items carry only the bare Transaction —
   * no aggregates, card or SCA data. Subject to the 1-request-per-5-seconds index
   * limit, so this is for backfill and reconciliation, never to serve a page view.
   */
  async listTransactions(
    query: ListTransactionsQuery = {},
  ): Promise<CursorPaginatedResponse<{ transaction: Transaction }>> {
    const response = await this.http.request<
      CursorPaginatedResponse<{ transaction: Transaction }>
    >(await this.auth(), "/transactions", {
      query: query as Record<string, unknown>,
    });
    return response.data;
  }

  /**
   * Walks every page of a transaction query, yielding one transaction at a time.
   *
   * Resumable: pass `startOffset` from a persisted cursor to continue an interrupted
   * run. The caller's rate limiter (via the http client's beforeRequest hook) paces
   * this; there is no internal sleeping.
   */
  async *iterateTransactions(
    query: ListTransactionsQuery = {},
    startOffset?: string,
    onPage?: (nextOffset: string | null) => Promise<void>,
  ): AsyncGenerator<Transaction, void, undefined> {
    let offset = startOffset ?? "";
    let hasMore = true;

    while (hasMore) {
      const page = await this.listTransactions({
        ...query,
        perPage: query.perPage ?? 500,
        offset,
      });

      for (const item of page.items) {
        yield item.transaction;
      }

      hasMore = page.hasMore && page.nextOffset !== null;
      offset = page.nextOffset ?? "";
      if (onPage) await onPage(page.nextOffset);
    }
  }

  /** Full detail including aggregates, operations and the acquirer agreement. */
  async getTransaction(transactionId: string): Promise<TransactionDetail> {
    const response = await this.http.request<TransactionDetail>(
      await this.auth(),
      `/transactions/${transactionId}`,
    );
    return response.data;
  }

  /**
   * The merchant-wide operations feed. Unlike the transaction list this is
   * page-numbered and returns a total, and it only ever returns operations that have
   * reached SUCCESS or FAILED.
   */
  async listOperations(
    query: ListOperationsQuery = {},
  ): Promise<PaginatedResponse<Operation>> {
    const response = await this.http.request<PaginatedResponse<Operation>>(
      await this.auth(),
      "/transactions/operations",
      { query: query as Record<string, unknown> },
    );
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Money operations. All synchronous, all idempotency-keyed, all 60s timeout.
  //
  // ePay returns HTTP 200 even when the operation failed, so every caller must
  // check `success` on the result rather than trusting the absence of a throw.
  // -------------------------------------------------------------------------

  async capture(
    transactionId: string,
    amount: number,
    idempotencyKey: string,
    voidRemaining = false,
  ): Promise<OperationResponse> {
    const response = await this.http.request<OperationResponse>(
      await this.auth(),
      `/transactions/${transactionId}/capture`,
      {
        method: "POST",
        body: { amount, voidRemaining },
        idempotencyKey,
        timeoutMs: TIMEOUTS.operation,
      },
    );
    return response.data;
  }

  /**
   * Refunds a captured amount.
   *
   * Against a transaction with multiple partial captures this returns one operation per
   * capture, any of which can fail independently — so a false `success` may mean
   * partial success and the operations array has to be reconciled individually.
   */
  async refund(
    transactionId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<RefundResponse> {
    const response = await this.http.request<RefundResponse>(
      await this.auth(),
      `/transactions/${transactionId}/refund`,
      {
        method: "POST",
        body: { amount },
        idempotencyKey,
        timeoutMs: TIMEOUTS.operation,
      },
    );
    return response.data;
  }

  /** Pass -1 to void the entire remaining authorization. Zero is rejected by ePay. */
  async void(
    transactionId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<OperationResponse> {
    const response = await this.http.request<OperationResponse>(
      await this.auth(),
      `/transactions/${transactionId}/void`,
      {
        method: "POST",
        body: { amount },
        idempotencyKey,
        timeoutMs: TIMEOUTS.operation,
      },
    );
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Settlements. Amounts are decimal strings here, not minor units.
  // -------------------------------------------------------------------------

  /**
   * Settlement transfers, newest first.
   *
   * These endpoints have no filters whatsoever — no date range, no acquirer, and no way
   * to look a transfer up by transaction id. The only tractable approach is to ingest
   * each transfer once when settlement.transfer-ready.v1 fires.
   */
  async listSettlementTransfers(
    perPage = 100,
    offset = "",
  ): Promise<CursorPaginatedResponse<{ settlementTransfer: SettlementTransfer }>> {
    const response = await this.http.request<
      CursorPaginatedResponse<{ settlementTransfer: SettlementTransfer }>
    >(await this.auth(), "/settlements/transfers", {
      query: { perPage, offset },
    });
    return response.data;
  }

  async getSettlementTransfer(transferId: string): Promise<SettlementTransfer> {
    const response = await this.http.request<{
      settlementTransfer: SettlementTransfer;
    }>(await this.auth(), `/settlements/transfers/${transferId}`);
    return response.data.settlementTransfer;
  }

  /**
   * The per-transaction settlement rows for one transfer, each carrying the acquirer,
   * interchange and scheme fees. This is the join that makes fee transparency and
   * acquirer comparison possible.
   */
  async listSettlementTransactions(
    transferId: string,
    perPage = 500,
    offset = "",
  ): Promise<CursorPaginatedResponse<SettlementTransactionItem>> {
    const response = await this.http.request<
      CursorPaginatedResponse<SettlementTransactionItem>
    >(await this.auth(), `/settlements/transfers/${transferId}/transactions`, {
      query: { perPage, offset },
    });
    return response.data;
  }

  async *iterateSettlementTransactions(
    transferId: string,
  ): AsyncGenerator<SettlementTransactionItem, void, undefined> {
    let offset = "";
    let hasMore = true;
    while (hasMore) {
      const page = await this.listSettlementTransactions(transferId, 500, offset);
      for (const item of page.items) yield item;
      hasMore = page.hasMore && page.nextOffset !== null;
      offset = page.nextOffset ?? "";
    }
  }

  // -------------------------------------------------------------------------
  // Management
  // -------------------------------------------------------------------------

  async listPointsOfSale(
    page = 1,
    perPage = 100,
  ): Promise<PaginatedResponse<DetailedPointOfSale>> {
    const response = await this.http.request<PaginatedResponse<DetailedPointOfSale>>(
      await this.auth(),
      "/management/point-of-sales",
      { query: { page, perPage } },
    );
    return response.data;
  }

  async getPointOfSale(pointOfSaleId: string): Promise<DetailedPointOfSale> {
    const response = await this.http.request<DetailedPointOfSale>(
      await this.auth(),
      `/management/point-of-sales/${pointOfSaleId}`,
    );
    return response.data;
  }

  /**
   * Creates a point of sale.
   *
   * Only three fields are accepted; the hosted configuration cannot be set and there is
   * no update endpoint, so behaviour is driven per-request on /cit instead.
   * `webhookAuthentication` is write-once via API — it must be unique per merchant and
   * correct the first time.
   */
  async createPointOfSale(
    request: CreatePointOfSaleRequest,
  ): Promise<DetailedPointOfSale> {
    const response = await this.http.request<DetailedPointOfSale>(
      await this.auth(),
      "/management/point-of-sales",
      { method: "POST", body: request },
    );
    return response.data;
  }

  async createApiKey(name: string): Promise<CreatedApiKey> {
    const response = await this.http.request<CreatedApiKey>(
      await this.auth(),
      "/management/api-keys",
      { method: "POST", body: { name } },
    );
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  async listWebhooks(page = 1, perPage = 100): Promise<PaginatedResponse<Webhook>> {
    const response = await this.http.request<PaginatedResponse<Webhook>>(
      await this.auth(),
      "/webhooks",
      { query: { page, perPage } },
    );
    return response.data;
  }

  /** The URL must be on a domain already approved for one of the points of sale. */
  async createWebhook(request: CreateWebhookRequest): Promise<Webhook> {
    const response = await this.http.request<Webhook>(await this.auth(), "/webhooks", {
      method: "POST",
      body: request,
    });
    return response.data;
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.http.request<void>(await this.auth(), `/webhooks/${webhookId}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Sessions and links
  // -------------------------------------------------------------------------

  async initializeSession(
    request: InitializeSessionRequest,
    idempotencyKey?: string,
  ): Promise<SessionResponse> {
    const response = await this.http.request<SessionResponse>(
      await this.auth(),
      "/cit",
      {
        method: "POST",
        body: request,
        idempotencyKey,
        timeoutMs: TIMEOUTS.session,
      },
    );
    return response.data;
  }

  async createPaymentLink(
    request: InitializeSessionRequest,
    idempotencyKey?: string,
  ): Promise<PaymentLink> {
    const response = await this.http.request<PaymentLink>(
      await this.auth(),
      "/payment-links",
      { method: "POST", body: request, idempotencyKey },
    );
    return response.data;
  }

  async cancelPaymentLink(linkId: string): Promise<void> {
    await this.http.request<void>(await this.auth(), `/payment-links/${linkId}`, {
      method: "DELETE",
    });
  }

  /**
   * Creates a reusable link that mints a fresh payment session on every scan.
   *
   * Unlike a payment link, this is a template rather than one payment — which is what
   * makes it work as a printed QR code on a market stall or a tip jar. Note that
   * configuration omitted here is resolved from the point of sale *when the link is
   * used*, so changing point-of-sale settings later changes the behaviour of a QR code
   * that has already been printed.
   */
  async createMultiLink(
    request: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<MultiLink> {
    const response = await this.http.request<MultiLink>(
      await this.auth(),
      "/multi-links",
      { method: "POST", body: request, idempotencyKey },
    );
    return response.data;
  }

  async listMultiLinks(
    query: Record<string, unknown> = {},
  ): Promise<PaginatedResponse<MultiLink>> {
    const response = await this.http.request<PaginatedResponse<MultiLink>>(
      await this.auth(),
      "/multi-links",
      { query },
    );
    return response.data;
  }

  async deactivateMultiLink(multiLinkId: string): Promise<void> {
    await this.http.request<void>(await this.auth(), `/multi-links/${multiLinkId}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Subscriptions and billing
  // -------------------------------------------------------------------------

  /**
   * Charges a stored subscription for an arbitrary amount.
   *
   * This is the primitive for variable recurring billing. A billing plan carries a
   * fixed amount, so it cannot express a monthly invoice whose total changes with
   * volume; MIT takes the amount per charge instead.
   *
   * Processing is asynchronous — ePay states MIT "cannot run in real time" and some
   * methods take days — so the outcome arrives on the notification webhook, not in
   * this response.
   */
  async mitAuthorization(
    request: {
      subscriptionId: string;
      amount: number;
      notificationUrl: string;
      currency?: string | null;
      reference?: string;
      instantCapture?: string;
      textOnStatement?: string;
    },
    idempotencyKey: string,
  ): Promise<{ transaction: Transaction }> {
    const response = await this.http.request<{ transaction: Transaction }>(
      await this.auth(),
      "/mit",
      {
        method: "POST",
        body: request,
        idempotencyKey,
        timeoutMs: TIMEOUTS.session,
      },
    );
    return response.data;
  }

  async listSubscriptions(
    query: Record<string, unknown> = {},
  ): Promise<PaginatedResponse<{ subscription: Subscription }>> {
    const response = await this.http.request<
      PaginatedResponse<{ subscription: Subscription }>
    >(await this.auth(), "/subscriptions", { query });
    return response.data;
  }

  async createBillingPlan(request: CreateBillingPlanRequest): Promise<BillingPlan> {
    const response = await this.http.request<BillingPlan>(
      await this.auth(),
      "/subscriptions/billing/plans",
      { method: "POST", body: request },
    );
    return response.data;
  }

  async listBillingPlans(): Promise<PaginatedResponse<BillingPlan>> {
    const response = await this.http.request<PaginatedResponse<BillingPlan>>(
      await this.auth(),
      "/subscriptions/billing/plans",
    );
    return response.data;
  }

  async createBillingAgreement(
    request: CreateBillingAgreementRequest,
  ): Promise<BillingAgreement> {
    const response = await this.http.request<BillingAgreement>(
      await this.auth(),
      "/subscriptions/billing/agreements",
      { method: "POST", body: request },
    );
    return response.data;
  }

  async stopBillingAgreement(agreementId: string): Promise<BillingAgreement> {
    const response = await this.http.request<BillingAgreement>(
      await this.auth(),
      `/subscriptions/billing/agreements/${agreementId}/stop`,
      { method: "POST" },
    );
    return response.data;
  }

  async resumeBillingAgreement(
    agreementId: string,
    nextChargeAt: string,
  ): Promise<BillingAgreement> {
    const response = await this.http.request<BillingAgreement>(
      await this.auth(),
      `/subscriptions/billing/agreements/${agreementId}/resume`,
      { method: "POST", body: { nextChargeAt } },
    );
    return response.data;
  }

  async listBillingCharges(
    billingAgreementId?: string,
    page = 1,
    perPage = 100,
  ): Promise<PaginatedResponse<BillingAgreementCharge>> {
    const response = await this.http.request<
      PaginatedResponse<BillingAgreementCharge>
    >(await this.auth(), "/subscriptions/billing/charges", {
      query: { billingAgreementId, page, perPage },
    });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Terminals
  // -------------------------------------------------------------------------

  /**
   * Lists SoftPay terminals. Read-only — there is no provisioning endpoint, and the
   * response carries no status, last-seen or battery information, so terminal liveness
   * has to be derived from transaction flow.
   */
  async listTerminals(
    pointOfSaleId?: string,
    page = 1,
    perPage = 100,
  ): Promise<PaginatedResponse<TerminalResource>> {
    const response = await this.http.request<PaginatedResponse<TerminalResource>>(
      await this.auth(),
      "/terminals",
      { query: { pointOfSaleId, page, perPage } },
    );
    return response.data;
  }
}
