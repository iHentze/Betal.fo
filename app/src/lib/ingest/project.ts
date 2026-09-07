import type { Database, D1PreparedStatement } from "~/lib/db/types";
import type {
  EventWebhook,
  NotificationWebhook,
  Operation,
  SettlementTransfer,
  Transaction,
} from "~/lib/epay";

/**
 * Projects an ePay webhook payload into the mirror.
 *
 * Two payload shapes arrive here. A session's `notificationUrl` receives a flat
 * NotificationWebhook, which is the only place `card` and `sca` ever appear. Registered
 * webhooks receive an `{event, data}` EventWebhook, which never carries them.
 *
 * Everything is written as an upsert, because ePay retries a delivery up to 25 times
 * and events for one transaction arrive out of order. The critical detail is that the
 * webhook-only columns are merged with COALESCE rather than overwritten: a later
 * transaction.captured event must not blank the card details a earlier
 * transaction.success delivery gave us, since no API call could ever recover them.
 */

function epochMs(iso: string | null | undefined): number {
  if (!iso) return Date.now();
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function transactionUpsert(
  db: Database,
  merchantId: string,
  transaction: Transaction,
  extras: {
    aggregates?: NotificationWebhook["aggregates"];
    acquirer?: string | null;
    mcc?: string | null;
    card?: NotificationWebhook["card"];
    sca?: NotificationWebhook["sca"];
    source?: string;
  } = {},
): D1PreparedStatement {
  const { aggregates, card, sca } = extras;

  return db
    .prepare(
      `INSERT INTO txn (
         id, merchant_id, point_of_sale_id, session_id, subscription_id,
         billing_agreement_charge_id, state, type, error_code, amount, surcharge,
         currency, payment_method_id, payment_method_type, payment_method_sub_type,
         payment_method_display, payment_method_expiry, sca_mode, instant_capture,
         customer_id, reference, text_on_statement, exemptions, attributes,
         client_ip, client_country, acquirer, mcc,
         amount_authorized, amount_captured, amount_refunded, amount_voided,
         amount_remaining, amount_paid_out,
         card_masked_pan, card_expire_month, card_expire_year, card_par, card_issuer,
         card_scheme, card_country, card_segment, card_funding,
         sca_rejected, sca_type, sca_verification,
         created_at, created_at_ms, synced_at_ms, source
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
         ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32,
         ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41, ?42, ?43, ?44, ?45, ?46, ?47,
         ?48, ?49, ?50
       )
       ON CONFLICT (id) DO UPDATE SET
         state            = excluded.state,
         error_code       = excluded.error_code,
         amount           = excluded.amount,
         surcharge        = excluded.surcharge,
         reference        = COALESCE(excluded.reference, txn.reference),
         acquirer         = COALESCE(excluded.acquirer, txn.acquirer),
         mcc              = COALESCE(excluded.mcc, txn.mcc),
         amount_authorized = COALESCE(excluded.amount_authorized, txn.amount_authorized),
         amount_captured   = COALESCE(excluded.amount_captured, txn.amount_captured),
         amount_refunded   = COALESCE(excluded.amount_refunded, txn.amount_refunded),
         amount_voided     = COALESCE(excluded.amount_voided, txn.amount_voided),
         amount_remaining  = COALESCE(excluded.amount_remaining, txn.amount_remaining),
         amount_paid_out   = COALESCE(excluded.amount_paid_out, txn.amount_paid_out),
         -- Webhook-only fields: never regress a known value back to null.
         card_masked_pan   = COALESCE(excluded.card_masked_pan, txn.card_masked_pan),
         card_expire_month = COALESCE(excluded.card_expire_month, txn.card_expire_month),
         card_expire_year  = COALESCE(excluded.card_expire_year, txn.card_expire_year),
         card_par          = COALESCE(excluded.card_par, txn.card_par),
         card_issuer       = COALESCE(excluded.card_issuer, txn.card_issuer),
         card_scheme       = COALESCE(excluded.card_scheme, txn.card_scheme),
         card_country      = COALESCE(excluded.card_country, txn.card_country),
         card_segment      = COALESCE(excluded.card_segment, txn.card_segment),
         card_funding      = COALESCE(excluded.card_funding, txn.card_funding),
         sca_rejected      = COALESCE(excluded.sca_rejected, txn.sca_rejected),
         sca_type          = COALESCE(excluded.sca_type, txn.sca_type),
         sca_verification  = COALESCE(excluded.sca_verification, txn.sca_verification),
         synced_at_ms      = excluded.synced_at_ms`,
    )
    .bind(
      transaction.id,
      merchantId,
      transaction.pointOfSaleId ?? null,
      transaction.sessionId ?? null,
      transaction.subscriptionId ?? null,
      transaction.billingAgreementChargeId ?? null,
      transaction.state,
      transaction.type,
      transaction.errorCode ?? null,
      transaction.amount,
      transaction.fee ?? 0,
      transaction.currency,
      transaction.paymentMethodId ?? null,
      transaction.paymentMethodType ?? null,
      transaction.paymentMethodSubType ?? null,
      transaction.paymentMethodDisplayText ?? null,
      transaction.paymentMethodExpiry ?? null,
      transaction.scaMode ?? null,
      transaction.instantCapture ?? null,
      transaction.customerId ?? null,
      transaction.reference ?? null,
      transaction.textOnStatement ?? null,
      JSON.stringify(transaction.exemptions ?? []),
      JSON.stringify(transaction.attributes ?? {}),
      transaction.clientIp ?? null,
      transaction.clientCountry ?? null,
      extras.acquirer ?? null,
      extras.mcc ?? null,
      aggregates?.authorized ?? null,
      aggregates?.captured ?? null,
      aggregates?.refunded ?? null,
      aggregates?.voided ?? null,
      aggregates?.remaining ?? null,
      aggregates?.paidOut ?? null,
      card?.pan ?? null,
      card?.expireMonth ?? null,
      card?.expireYear ?? null,
      card?.par ?? null,
      card?.Issuer ?? null,
      card?.Scheme ?? null,
      card?.Country ?? null,
      card?.Segment ?? null,
      card?.Funding ?? null,
      sca ? (sca.rejected ? 1 : 0) : null,
      sca?.type ?? null,
      sca?.verification ?? null,
      transaction.createdAt,
      epochMs(transaction.createdAt),
      Date.now(),
      extras.source ?? "webhook",
    );
}

export function operationUpsert(
  db: Database,
  merchantId: string,
  operation: Operation,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO operation (
         id, transaction_id, merchant_id, reference_operation_id, type, state,
         amount, error_code, created_at, created_at_ms, finalized_at, finalized_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT (id) DO UPDATE SET
         state           = excluded.state,
         error_code      = excluded.error_code,
         finalized_at    = COALESCE(excluded.finalized_at, operation.finalized_at),
         finalized_at_ms = COALESCE(excluded.finalized_at_ms, operation.finalized_at_ms)`,
    )
    .bind(
      operation.id,
      operation.transactionId,
      merchantId,
      operation.referenceTransactionOperationId ?? null,
      operation.type,
      operation.state,
      operation.amount,
      operation.errorCode ?? null,
      operation.createdAt,
      epochMs(operation.createdAt),
      operation.finalizedAt ?? null,
      operation.finalizedAt ? epochMs(operation.finalizedAt) : null,
    );
}

export function settlementTransferUpsert(
  db: Database,
  merchantId: string,
  transfer: SettlementTransfer,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO settlement_transfer (
           id, merchant_id, acquirer, settlement_name, settlement_ids, posting_date,
           net_amount, currency, acquirer_reference, created_at, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (id) DO UPDATE SET
           net_amount = excluded.net_amount,
           posting_date = excluded.posting_date`,
      )
      .bind(
        transfer.id,
        merchantId,
        transfer.acquirer ?? null,
        transfer.settlementName ?? null,
        JSON.stringify(transfer.settlementIds ?? []),
        transfer.postingDate ?? null,
        // Kept as the decimal string ePay sent. Never parsed as a float.
        transfer.netAmount,
        transfer.currency,
        transfer.acquirerReference ?? null,
        transfer.createdAt,
        epochMs(transfer.createdAt),
      ),
  ];

  for (const [index, adjustment] of (transfer.adjustments ?? []).entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO settlement_adjustment (
             id, merchant_id, settlement_transfer_id, settlement_transaction_id,
             scope, type, amount, description
           ) VALUES (?1, ?2, ?3, NULL, 'transfer', ?4, ?5, ?6)
           ON CONFLICT (id) DO UPDATE SET amount = excluded.amount`,
        )
        .bind(
          `${transfer.id}:transfer:${index}`,
          merchantId,
          transfer.id,
          adjustment.type,
          adjustment.amount,
          adjustment.description ?? null,
        ),
    );
  }

  return statements;
}

export interface ProjectionResult {
  statements: D1PreparedStatement[];
  /** Set when the payload told us something the mirror should react to. */
  transactionId?: string;
  settlementTransferId?: string;
}

/** Projects the flat NotificationWebhook delivered to a session's notificationUrl. */
export function projectNotification(
  db: Database,
  merchantId: string,
  payload: NotificationWebhook,
): ProjectionResult {
  const statements: D1PreparedStatement[] = [];
  const transaction = payload.transaction;
  if (!transaction) return { statements };

  statements.push(
    transactionUpsert(db, merchantId, transaction, {
      aggregates: payload.aggregates,
      acquirer: payload.acquirerAgreement?.acquirer ?? null,
      mcc: payload.acquirerAgreement?.mcc ?? null,
      card: payload.card,
      sca: payload.sca,
      source: "notification",
    }),
  );

  for (const operation of payload.operations ?? []) {
    statements.push(operationUpsert(db, merchantId, operation));
  }

  return { statements, transactionId: transaction.id };
}

/** Projects the `{event, data}` envelope delivered to a registered webhook. */
export function projectEvent(
  db: Database,
  merchantId: string,
  payload: EventWebhook,
): ProjectionResult {
  const statements: D1PreparedStatement[] = [];
  const result: ProjectionResult = { statements };
  const data = payload.data ?? {};

  if (data.transaction) {
    statements.push(
      transactionUpsert(db, merchantId, data.transaction, { source: "event" }),
    );
    result.transactionId = data.transaction.id;
  }

  if (data.operation) {
    statements.push(operationUpsert(db, merchantId, data.operation));
    result.transactionId ??= data.operation.transactionId;
  }

  if (data.settlementTransfer) {
    statements.push(
      ...settlementTransferUpsert(db, merchantId, data.settlementTransfer),
    );
    result.settlementTransferId = data.settlementTransfer.id;
  }

  if (data.subscription) {
    statements.push(
      db
        .prepare(
          `UPDATE txn SET synced_at_ms = ?1
             WHERE merchant_id = ?2 AND subscription_id = ?3`,
        )
        .bind(Date.now(), merchantId, data.subscription.id),
    );
  }

  return result;
}

/**
 * Recomputes a transaction's aggregate columns from its operations.
 *
 * Needed because the `{event, data}` envelope carries no aggregates: a
 * transaction.captured event tells us an operation happened but not what the running
 * captured total now is. Deriving from our own operation rows keeps list views correct
 * between reconciliations.
 */
export function recomputeAggregates(
  db: Database,
  transactionId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE txn SET
         amount_captured = COALESCE((
           SELECT SUM(amount) FROM operation
            WHERE transaction_id = ?1 AND state = 'SUCCESS' AND type IN ('CAPTURE','SALE')
         ), amount_captured),
         amount_refunded = COALESCE((
           SELECT SUM(amount) FROM operation
            WHERE transaction_id = ?1 AND state = 'SUCCESS' AND type = 'REFUND'
         ), amount_refunded),
         amount_voided = COALESCE((
           SELECT SUM(amount) FROM operation
            WHERE transaction_id = ?1 AND state = 'SUCCESS' AND type = 'VOID'
         ), amount_voided),
         synced_at_ms = ?2
       WHERE id = ?1`,
    )
    .bind(transactionId, Date.now());
}
