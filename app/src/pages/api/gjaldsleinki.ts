import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { Epay } from "~/lib/epay";
import { createMultiLink, createPaymentLink } from "~/lib/products";
import { scopeToMerchant } from "~/lib/auth";
import { AuthorizationError, requireCapability } from "~/lib/audit";

export const prerender = false;

/** Creates a payment link, or a reusable QR code when `slag=multi`. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });

  const db = env.DB;

  let merchantId: string;
  try {
    merchantId = scopeToMerchant(actor, url.searchParams.get("handil"));
  } catch {
    return new Response("forbidden", { status: 403 });
  }

  try {
    await requireCapability(db, { ...actor, merchantId }, "move_money", {
      action: "create_payment_link",
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("forbidden", { status: 403 });
    }
    throw error;
  }

  const form = await request.formData();
  const amount = Number.parseInt(String(form.get("amount") ?? "0"), 10);
  const reference = String(form.get("reference") ?? "").trim() || undefined;
  const isMulti = url.searchParams.get("slag") === "multi";

  if (!Number.isInteger(amount) || amount < 0 || (!isMulti && amount < 1)) {
    return new Response("bad amount", { status: 400 });
  }

  const merchant = await db
    .prepare(
      `SELECT m.epay_account_id, m.environment,
              (SELECT p.id FROM point_of_sale p WHERE p.merchant_id = m.id LIMIT 1)
                AS point_of_sale_id
         FROM merchant m WHERE m.id = ?1`,
    )
    .bind(merchantId)
    .first<{
      epay_account_id: string;
      environment: string;
      point_of_sale_id: string | null;
    }>();

  if (!merchant?.point_of_sale_id) {
    return new Response("merchant has no point of sale", { status: 409 });
  }

  const epay = new Epay({ partnerKey: env.EPAY_PARTNER_KEY, tokens: env.TOKENS });
  const client = epay.forMerchant(
    merchant.epay_account_id,
    merchant.environment === "live" ? "live" : "test",
  );

  if (isMulti) {
    const link = await createMultiLink(db, client, {
      merchantId,
      pointOfSaleId: merchant.point_of_sale_id,
      amountMinor: amount,
      label: reference ?? "Betal",
      // Letting the payer set the amount is what makes a printed code work as a tip
      // jar or a market stall. ePay gates this per account, so it may be rejected.
      dynamicAmount: amount === 0,
      actorEmail: actor.email,
    });

    return new Response(null, {
      status: 303,
      headers: { Location: `/gjaldsleinki?qr=${encodeURIComponent(link.qrUrl)}` },
    });
  }

  const link = await createPaymentLink(db, client, {
    merchantId,
    pointOfSaleId: merchant.point_of_sale_id,
    amountMinor: amount,
    reference,
    description: reference,
    actorEmail: actor.email,
  });

  return new Response(null, {
    status: 303,
    headers: { Location: `/gjaldsleinki?leinki=${encodeURIComponent(link.url)}` },
  });
};
