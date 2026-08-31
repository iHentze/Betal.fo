/**
 * Types for the ePay Payments API (docs.epay.eu), transcribed from the published
 * OpenAPI spec. Field names and casing match the wire format exactly — including the
 * PascalCase keys on `Card`, which are inconsistent with the rest of the API but are
 * what ePay actually sends.
 *
 * Amounts on transactions are integer minor units. Amounts on settlements are decimal
 * strings and are typed as `string` here so they can never be accidentally parsed as
 * floats.
 */

export type Environment = "test" | "live";

export type TransactionState = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";
export type TransactionType = "PAYMENT" | "PAYOUT" | "MOTO";
export type OperationState = "PROCESSING" | "SUCCESS" | "FAILED";
export type OperationType =
  | "AUTHORIZATION"
  | "SALE"
  | "CAPTURE"
  | "REFUND"
  | "VOID"
  | "PAYOUT";
export type ScaMode = "SKIP" | "NORMAL" | "FORCE";
export type InstantCapture = "OFF" | "VOID" | "NO_VOID";
export type Exemption = "TRA" | "LVT";
export type SubscriptionState = "PENDING" | "ACTIVE" | "INVALID" | "DISABLED";
export type SubscriptionType = "SCHEDULED" | "UNSCHEDULED";
export type BillingAgreementState = "PENDING" | "ACTIVE" | "STOPPED";
export type BillingChargeState = "PROCESSING" | "FAILED" | "SUCCESS";
export type BillingPeriod = "DAY" | "WEEK" | "MONTH" | "YEAR";
export type SessionState = "PENDING" | "PROCESSING" | "COMPLETED" | "EXPIRED";

export type PaymentMethodType =
  | "CARD"
  | "VIPPS_MOBILEPAY"
  | "MOBILEPAY_ONLINE"
  | "APPLE_PAY"
  | "GOOGLE_PAY"
  | "SWISH"
  | "VIABILL"
  | "ANYDAY"
  | "KLARNA";

/** Transfer-level adjustments use the first three; transaction-level use the last three. */
export type SettlementAdjustmentType =
  | "RESERVE"
  | "ADJUSTMENT"
  | "FEE"
  | "ACQUIRER_FEE"
  | "INTERCHANGE_FEE"
  | "SCHEME_FEE";

export type WebhookEvent =
  | "transaction.success.v1"
  | "transaction.failed.v1"
  | "transaction.captured.v1"
  | "transaction.refunded.v1"
  | "transaction.voided.v1"
  | "transaction.renewed.v1"
  | "subscription.disabled.v1"
  | "subscription-billing.charge-created.v1"
  | "subscription-billing.charge-success.v1"
  | "subscription-billing.charge-failed.v1"
  | "subscription-billing.agreement-active.v1"
  | "subscription-billing.agreement-stopped.v1"
  | "settlement.transfer-ready.v1";

export type WebhookPauseReason = "ERROR_RATE_TOO_HIGH" | "PAUSED_BY_MERCHANT";

// ---------------------------------------------------------------------------
// Pagination. ePay uses two incompatible schemes.
// ---------------------------------------------------------------------------

/** Page-number pagination. Returns totals, so "page 7 of 340" is renderable. */
export interface PaginatedResponse<T> {
  page: number;
  perPage: number;
  lastPage: number;
  total: number;
  nextPage: number | null;
  previousPage: number | null;
  from: number;
  to: number;
  items: T[];
}

/**
 * Cursor pagination, used by transactions, settlements and imported payment methods.
 * There is no total count, so offsets cannot be skipped and result counts cannot be
 * shown before walking the whole set.
 */
export interface CursorPaginatedResponse<T> {
  currentOffset: string;
  nextOffset: string | null;
  perPage: number;
  hasMore: boolean;
  items: T[];
}

// ---------------------------------------------------------------------------
// Partner
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  name: string;
  addressLineOne: string | null;
  addressLineTwo: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  invoiceEmail: string | null;
  invoiceAttention: string | null;
  vat: string | null;
  currencyCode: string | null;
  /** Undocumented enum — ePay publishes no list of values. Treated as opaque. */
  status: string;
  createdAt: string;
}

export interface CreateAccountRequest {
  name: string;
  email: string;
  currencyCode: string;
  timezone: string;
  domain: string;
  language?: string;
}

export interface AccessToken {
  accessToken: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

export interface PointOfSale {
  id: string;
  name: string;
  /** What the cardholder sees on their statement. Readable but not settable via API. */
  descriptor: string;
  createdAt: string;
  updatedAt: string;
}

/** Defaults for session initialization. Every field is read-only through the API. */
export interface HostedConfiguration {
  instantCapture: InstantCapture;
  scaMode: ScaMode;
  timeout: number;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  retryUrl: string | null;
  maxAttempts: number;
  processor: string[];
  exemptions: Exemption[];
  reportFailure: boolean;
  reportExpired?: boolean;
}

export interface DetailedPointOfSale {
  pointOfSale: PointOfSale;
  hostedConfiguration: HostedConfiguration;
}

export interface CreatePointOfSaleRequest {
  name: string;
  domain: string;
  /**
   * The complete Authorization header value ePay will send on webhooks, including the
   * scheme. Write-once: it cannot be changed via API afterwards.
   */
  webhookAuthentication: string;
}

export interface CreatedApiKey {
  name: string;
  key: string;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  subscriptionId: string | null;
  billingAgreementChargeId: string | null;
  state: TransactionState;
  errorCode: string | null;
  externalStatusCodes: Record<string, string> | null;
  createdAt: string;
  sessionId: string | null;
  paymentMethodId: string;
  paymentMethodType: PaymentMethodType;
  paymentMethodSubType: string | null;
  paymentMethodExpiry: string | null;
  paymentMethodDisplayText: string;
  paymentMethodHolderName: string | null;
  scaMode: ScaMode;
  customerId: string | null;
  amount: number;
  /**
   * A surcharge ePay adds to what the cardholder pays, already included in `amount`.
   * This is not Betal revenue and not an acquirer cost.
   */
  fee: number;
  currency: string;
  instantCapture: InstantCapture;
  notificationUrl: string;
  pointOfSaleId: string;
  reference: string | null;
  textOnStatement: string | null;
  exemptions: Exemption[];
  attributes: Record<string, string>;
  clientIp: string;
  clientCountry: string;
  type: TransactionType;
}

export interface OperationAggregates {
  authorized: number;
  captured: number;
  refunded: number;
  voided: number;
  remaining: number;
  paidOut: number;
}

export interface Operation {
  id: string;
  referenceTransactionOperationId: string | null;
  amount: number;
  state: OperationState;
  transactionId: string;
  type: OperationType;
  errorCode: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface AcquirerAgreement {
  acquirer: string;
  mcc: string;
}

/** Only ever delivered on a webhook. No GET endpoint returns this. */
export interface Card {
  pan: string;
  expireMonth: string;
  expireYear: string;
  par: string | null;
  Issuer: string | null;
  Scheme: string | null;
  Country: string | null;
  Segment: string | null;
  Funding: string | null;
}

/** Only ever delivered on a webhook. No GET endpoint returns this. */
export interface ScaStatus {
  rejected: boolean;
  type: "3DS" | "DELEGATED" | "UNKNOWN";
  verification: "NONE" | "FRICTIONLESS" | "CHALLENGED" | "UNKNOWN";
}

export interface TransactionDetail {
  transaction: Transaction;
  aggregates: OperationAggregates;
  operations: Operation[];
  acquirerAgreement: AcquirerAgreement;
}

export interface ListTransactionsQuery {
  perPage?: number;
  offset?: string;
  sessionId?: string;
  terminalId?: string;
  pointOfSaleId?: string;
  subscriptionId?: string;
  billingAgreementChargeId?: string;
  reference?: string;
  referenceMode?: "EXACT" | "PREFIX";
  /** Inclusive. Consecutive windows will double-count unless the boundary is handled. */
  createdBefore?: string;
  /** Inclusive. */
  createdAfter?: string;
  customerId?: string;
  currency?: string;
  state?: TransactionState;
  type?: TransactionType;
  errorCode?: string;
  paymentMethodType?: PaymentMethodType;
  paymentMethodSubType?: string;
  amountMode?: "EQUAL" | "LESS_THAN" | "GREATER_THAN";
  amount?: number;
  feeMode?: "EQUAL" | "LESS_THAN" | "GREATER_THAN";
  fee?: number;
}

export interface ListOperationsQuery {
  page?: number;
  perPage?: number;
  finalizedBefore?: string;
  finalizedAfter?: string;
  pointOfSaleId?: string[];
}

export interface EpayErrorCode {
  code: string;
  message: string;
}

/**
 * Returned by capture, void and renew. Note that ePay returns HTTP 200 even when the
 * operation failed, so `success` must always be checked.
 */
export interface OperationResponse {
  operationId: string;
  success: boolean;
  state: OperationState;
  errorCode: EpayErrorCode | null;
}

/**
 * Refunds against partially-captured transactions produce one operation per capture,
 * any of which may independently fail, so `success` false can mean partial success.
 */
export interface RefundResponse {
  success: boolean;
  operations: OperationResponse[];
}

// ---------------------------------------------------------------------------
// Settlements. Amounts here are decimal strings, not minor units.
// ---------------------------------------------------------------------------

export interface SettlementAdjustment {
  type: SettlementAdjustmentType;
  /** Decimal string, negative for fees, e.g. "-1.00". */
  amount: string;
  description: string;
}

export interface SettlementTransfer {
  id: string;
  acquirer: string;
  settlementName: string;
  /** The acquirer MIDs included in this settlement report. */
  settlementIds: string[];
  postingDate: string;
  /** Decimal string, net of adjustments and fees. */
  netAmount: string;
  currency: string;
  acquirerReference: string;
  /** Levied on the transfer itself: wire fees, reserve movements. */
  adjustments: SettlementAdjustment[];
  /** Rolled-up total of the per-transaction adjustments. */
  adjustmentSums: SettlementAdjustment[];
  createdAt: string;
}

export interface SettlementTransaction {
  id: string;
  settlementTransferId: string;
  /** Null when the acquirer row cannot be linked to an ePay transaction. */
  transactionId: string | null;
  /** The acquirer MID this executed on. */
  agreementId: string;
  merchantReference: string;
  acquirerReference: string;
  postingDate: string;
  settlementNetAmount: string;
  /** May differ from the transaction currency under single-currency settlement. */
  settlementCurrency: string;
  /** Acquirer, interchange and scheme costs. Not charged by ePay. */
  adjustments: SettlementAdjustment[];
  createdAt: string;
}

export interface SettlementTransactionItem {
  settlementTransaction: SettlementTransaction;
  transaction: Transaction | null;
}

// ---------------------------------------------------------------------------
// Subscriptions and billing
// ---------------------------------------------------------------------------

export interface SubscriptionInterval {
  period: BillingPeriod;
  frequency: number;
}

export interface Subscription {
  id: string;
  paymentMethodId: string | null;
  currency: string;
  customerId: string;
  pointOfSaleId: string;
  reference: string | null;
  description: string | null;
  state: SubscriptionState;
  statusReason: string | null;
  type: SubscriptionType;
  expiryDate: string | null;
  interval: SubscriptionInterval | null;
  createdAt: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  maxAttempts: number;
  interval: SubscriptionInterval;
  instantCapture: InstantCapture | null;
  color: string | null;
  emoji: string | null;
  createdAt: string;
}

export interface CreateBillingPlanRequest {
  name: string;
  amount: number;
  currency: string;
  maxAttempts: number;
  interval: SubscriptionInterval;
  instantCapture?: InstantCapture;
}

export interface BillingAgreement {
  id: string;
  billingPlanId: string;
  subscriptionId: string;
  sessionId: string | null;
  customerId: string | null;
  nextChargeAt: string | null;
  lastChargeAt: string | null;
  desiredDate: number | null;
  state: BillingAgreementState;
  stateChangedAt: string;
  reference: string | null;
  createdAt: string;
}

export interface CreateBillingAgreementRequest {
  billingPlanId: string;
  subscriptionId: string;
  reference?: string;
  nextChargeAt?: string;
}

export interface BillingAgreementCharge {
  id: string;
  state: BillingChargeState;
  transactionId: string | null;
  billingPlanId: string;
  billingAgreementId: string;
  deadlineAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  /** Non-null means ePay stopped delivering. Must be surfaced to the merchant. */
  pausedAt: string | null;
  pauseReason: WebhookPauseReason | null;
  createdAt: string;
}

export interface CreateWebhookRequest {
  url: string;
  events: WebhookEvent[];
  /** Becomes the literal Authorization header value on delivery. */
  secret: string;
}

/**
 * The payload delivered to a session's `notificationUrl`. This is a different shape
 * from the system-wide `{event, data}` envelope. `card` and `sca` appear here and
 * nowhere else in the API.
 */
export interface NotificationWebhook {
  transaction: Transaction;
  aggregates?: OperationAggregates;
  operations?: Operation[];
  acquirerAgreement?: AcquirerAgreement;
  session?: Record<string, unknown>;
  subscription?: Subscription;
  sca?: ScaStatus;
  card?: Card;
}

/** The system-wide webhook envelope. */
export interface EventWebhook {
  event: WebhookEvent;
  data: {
    transaction?: Transaction;
    operation?: Operation;
    subscription?: Subscription;
    billingAgreement?: BillingAgreement;
    billingAgreementCharge?: BillingAgreementCharge;
    settlementTransfer?: SettlementTransfer;
  };
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export interface Terminal {
  id: string;
  pointOfSaleId: string;
  deviceId: string | null;
  externalId: string;
  createdAt: string;
}

export interface TerminalDevice {
  id: string;
  description: string;
  createdAt: string;
}

export interface TerminalResource {
  terminal: Terminal;
  pointOfSale: PointOfSale;
  device: TerminalDevice | null;
}

// ---------------------------------------------------------------------------
// Sessions and payment links
// ---------------------------------------------------------------------------

export interface InitializeSessionRequest {
  pointOfSaleId: string;
  amount: number;
  currency: string;
  reference?: string;
  instantCapture?: InstantCapture;
  textOnStatement?: string;
  attributes?: Record<string, string>;
  customerId?: string;
  scaMode?: ScaMode;
  timeout?: number;
  exemptions?: Exemption[];
  allowedPaymentMethods?: PaymentMethodType[];
  maxAttempts?: number;
  generateQrCode?: boolean;
  reportFailure?: boolean;
  reportExpired?: boolean;
  dynamicAmount?: boolean;
  notificationUrl?: string;
  successUrl?: string;
  failureUrl?: string;
  retryUrl?: string;
  returnUrl?: string;
  preAuthUrl?: string;
  subscription?: {
    amount?: number;
    type: SubscriptionType;
    reference?: string;
    expiryDate?: string;
    interval?: SubscriptionInterval;
    billingAgreement?: {
      billingPlanId: string;
      reference?: string;
      nextChargeAt?: string;
    };
  };
}

export interface SessionResponse {
  paymentWindowUrl: string;
  javascript: string;
  key: string;
  qrCode?: string;
  session: {
    id: string;
    state: SessionState;
    expiresAt: string;
    [key: string]: unknown;
  };
}

export interface PaymentLink {
  id: string;
  sessionId: string;
  url: string;
  qrCode?: string;
}

export interface MultiLink {
  id: string;
  url: string;
  qrUrl: string;
  state: "ACTIVE" | "DEACTIVATED";
  createdAt: string;
}
