import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { Epay } from "~/lib/epay";
import { recordAudit, requireCapability, AuthorizationError } from "~/lib/audit";
import { scopeToMerchant } from "~/lib/auth";

export const prerender = false;

/**
 * Refunds a transaction.
 *
 * Everything that makes this safe lives here rather than in ePay: the token minted for
 * a merchant can refund and pay out with no read-only variant, so the role check, the
 * merchant scoping and the audit entry are the only things standing between a viewer
 * and someone else's money.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });

  const db = env.DB;
  const transactionId = params.id!;

  let merchantId: string;
  try {
    merchantId = scopeToMerchant(actor, new URL(request.url).searchParams.get("handil"));
  } catch {
    return new Response("forbidden", { status: 403 });
  }

  try {
    await requireCapability(db, { ...actor, merchantId }, "move_money", {
      action: "refund",
      subjectType: "transaction",
      subjectId: transactionId,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("forbidden", { status: 403 });
    }
    throw error;
  }

  const form = await request.formData();
  const amount = Number.parseInt(String(form.get("amount") ?? ""), 10);
  if (!Number.isInteger(amount) || amount < 1) {
    return new Response("bad amount", { status: 400 });
  }

  // Scoped to the merchant, so one merchant can never refund another's transaction
  // even by guessing an id.
  const transaction = await db
    .prepare(
      `SELECT id, currency, amount_captured, amount_refunded FROM txn
        WHERE id = ?1 AND merchant_id = ?2`,
    )
    .bind(transactionId, merchantId)
    .first<{
      id: string;
      currency: string;
      amount_captured: number | null;
      amount_refunded: number | null;
    }>();

  if (!transaction) return new Response("not found", { status: 404 });

  const refundable =
    (transaction.amount_captured ?? 0) - (transaction.amount_refunded ?? 0);
  if (amount > refundable) {
    return new Response("amount exceeds refundable balance", { status: 400 });
  }

  const merchant = await db
    .prepare(`SELECT epay_account_id, environment FROM merchant WHERE id = ?1`)
    .bind(merchantId)
    .first<{ epay_account_id: string; environment: string }>();

  if (!merchant) return new Response("not found", { status: 404 });

  const epay = new Epay({ partnerKey: env.EPAY_PARTNER_KEY, tokens: env.TOKENS });
  const client = epay.forMerchant(
    merchant.epay_account_id,
    merchant.environment === "live" ? "live" : "test",
  );

  // Keyed so a double-submitted form cannot refund twice. ePay caches the response for
  // 24 hours and flags the replay.
  const idempotencyKey = `refund:${transactionId}:${amount}:${actor.id}`;

  try {
    const result = await client.refund(transactionId, amount, idempotencyKey);

    await recordAudit(db, {
      actorUserId: actor.id,
      actorEmail: actor.email,
      merchantId,
      action: "refund",
      subjectType: "transaction",
      subjectId: transactionId,
      amountMinor: amount,
      currency: transaction.currency,
      // ePay returns HTTP 200 even when the operation failed, so the outcome comes
      // from the body rather than the status code.
      outcome: result.success ? "success" : "failure",
      detail: { operations: result.operations },
      ip: request.headers.get("cf-connecting-ip"),
    });

    return new Response(null, {
      status: 303,
      headers: {
        Location: `/gjaldingar/${transactionId}${result.success ? "" : "?feilur=1"}`,
      },
    });
  } catch (error) {
    await recordAudit(db, {
      actorUserId: actor.id,
      actorEmail: actor.email,
      merchantId,
      action: "refund",
      subjectType: "transaction",
      subjectId: transactionId,
      amountMinor: amount,
      currency: transaction.currency,
      outcome: "failure",
      detail: { error: error instanceof Error ? error.message : String(error) },
    });

    return new Response(null, {
      status: 303,
      headers: { Location: `/gjaldingar/${transactionId}?feilur=1` },
    });
  }
};
