/** Error envelopes returned by ePay, and the exceptions we raise for them. */

export interface EpayErrorBody {
  errorCode?: string;
  message?: string;
  /** Present on 422 responses: field name to array of validation messages. */
  errors?: Record<string, string[]>;
  /** Rate-limit and MIT-batch responses add this. */
  success?: boolean;
}

export class EpayError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly body: EpayErrorBody | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    errorCode: string,
    message: string,
    body?: EpayErrorBody,
    requestId?: string,
  ) {
    super(message);
    this.name = "EpayError";
    this.status = status;
    this.errorCode = errorCode;
    this.body = body;
    this.requestId = requestId;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class EpayValidationError extends EpayError {
  readonly fields: Record<string, string[]>;

  constructor(message: string, fields: Record<string, string[]>, body?: EpayErrorBody) {
    super(422, "VALIDATION_ERROR", message, body);
    this.name = "EpayValidationError";
    this.fields = fields;
  }
}

export class EpayRateLimitError extends EpayError {
  /** Seconds ePay asked us to wait, from the Retry-After header. */
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number, body?: EpayErrorBody) {
    super(429, "RATE_LIMIT_REACHED", message, body);
    this.name = "EpayRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class EpayAuthError extends EpayError {
  constructor(status: number, errorCode: string, message: string, body?: EpayErrorBody) {
    super(status, errorCode, message, body);
    this.name = "EpayAuthError";
  }
}

export class EpayTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, path: string) {
    super(`ePay request to ${path} timed out after ${timeoutMs}ms`);
    this.name = "EpayTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function errorFromResponse(
  status: number,
  body: EpayErrorBody | undefined,
  headers: Headers,
): EpayError {
  const message = body?.message ?? `ePay returned HTTP ${status}`;
  const code = body?.errorCode ?? `HTTP_${status}`;
  const requestId = headers.get("x-request-id") ?? undefined;

  if (status === 422 && body?.errors) {
    return new EpayValidationError(message, body.errors, body);
  }
  if (status === 429) {
    const header = headers.get("retry-after");
    const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
    return new EpayRateLimitError(
      message,
      Number.isFinite(seconds) ? seconds : undefined,
      body,
    );
  }
  if (status === 401 || status === 403) {
    return new EpayAuthError(status, code, message, body);
  }
  return new EpayError(status, code, message, body, requestId);
}
