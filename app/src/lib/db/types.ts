/**
 * The slice of the D1 API we use, declared locally so every module that touches the
 * database can be unit tested against an in-memory double without the Workers runtime.
 */

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; rows_written?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

/** Queue producer surface, likewise narrowed for testability. */
export interface QueueProducer<T> {
  send(message: T, options?: { contentType?: string }): Promise<void>;
}

export interface IngestMessage {
  deliveryId: string;
}

export interface Env {
  DB: Database;
  TOKENS: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  };
  INGEST_QUEUE?: QueueProducer<IngestMessage>;
  EPAY_PARTNER_KEY: string;
  /** Base URL this app is reachable at, used when registering webhooks with ePay. */
  APP_URL: string;
}
