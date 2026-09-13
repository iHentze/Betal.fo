import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack } from "~/lib/onboarding/access";
import { getActivePriceList } from "~/lib/onboarding/application";
import { fillAgreementPdf } from "~/lib/onboarding/pdf";
import { toArrayBuffer } from "~/lib/onboarding/bytes";
import { priceListKind, screenApplication } from "~/lib/onboarding/screening";
import { getDocumentBytes } from "~/lib/onboarding/documents";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, url }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });
  const id = params.id;
  if (!id) return new Response("not found", { status: 404 });

  let pack;
  try {
    pack = await requirePack(env.DB, actor, id, url.searchParams.get("handil"));
  } catch {
    return new Response("forbidden", { status: 403 });
  }

  if (pack.events.some((event) => event.kind === "skriva_signed")) {
    const signed = await getDocumentBytes(env.DB, id, "agreement");
    if (signed?.bytes) {
      const bytes = signed.bytes instanceof Uint8Array
        ? signed.bytes
        : new Uint8Array(signed.bytes);
      return new Response(toArrayBuffer(bytes), {
        headers: {
          "Content-Type": signed.content_type ?? "application/pdf",
          "Content-Disposition": `inline; filename="${
            signed.file_name ?? "kortinnloysing-fo-undirskrivad.pdf"
          }"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
  }

  const screening = screenApplication({
    sector: pack.application.vertical_sector,
    equity: pack.application.equity as "positive" | "negative" | "unknown" | null,
    operations: pack.application.operations as "positive" | "negative" | "unknown" | null,
  });
  const list = await getActivePriceList(env.DB, priceListKind(screening));

  try {
    const bytes = await fillAgreementPdf(pack, list);
    return new Response(toArrayBuffer(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="kortinnloysing-fo.pdf"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 409 });
  }
};
