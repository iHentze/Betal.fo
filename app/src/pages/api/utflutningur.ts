import type { APIRoute } from "astro";
import { accountingExport } from "~/lib/products";
import { scopeToMerchant } from "~/lib/auth";

export const prerender = false;

/**
 * Downloads a month of payments for bookkeeping.
 *
 * ePay integrates with e-conomic, which Faroese businesses largely do not use, so this
 * produces a plain file their accountant can open.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });

  let merchantId: string;
  try {
    merchantId = scopeToMerchant(actor, url.searchParams.get("handil"));
  } catch {
    return new Response("forbidden", { status: 403 });
  }

  const month = url.searchParams.get("man");
  const match = month ? /^(\d{4})-(\d{2})$/.exec(month) : null;
  if (!match) return new Response("bad month", { status: 400 });

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return new Response("bad month", { status: 400 });
  }

  const fromMs = Date.UTC(year, monthIndex, 1);
  const toMs = Date.UTC(year, monthIndex + 1, 1);

  const format = url.searchParams.get("snid") === "json" ? "json" : "csv";
  const file = await accountingExport(locals.runtime.env.DB, {
    merchantId,
    fromMs,
    toMs,
    format,
  });

  return new Response(file.body, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "no-store",
    },
  });
};
