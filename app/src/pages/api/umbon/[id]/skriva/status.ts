import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import { putDocument } from "~/lib/onboarding/documents";
import { recordEvent } from "~/lib/onboarding/application";
import { SkrivaClient, SkrivaError, skrivaConfig } from "~/lib/onboarding/skriva";
import { storeSignedDocumentInstance } from "~/lib/onboarding/document-instances";

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function message(path: string, key: "sent" | "feilur", value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

export const POST: APIRoute = async ({ params, locals, url }) => {
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

  const back = wizardPath(id, "undirskriva", actor, pack.application.merchant_id);
  const fail = (text: string) => redirect(message(back, "feilur", text));
  const latestRequestId = pack.signings.find(
    (row) => row.provider === "skriva" && row.signing_request_id,
  )?.signing_request_id;
  const rows = pack.signings.filter(
    (row) =>
      row.provider === "skriva" &&
      row.signing_request_id === latestRequestId &&
      row.signer_token,
  );
  if (rows.length === 0) return fail("Eingin Skriva-undirskrift er stovnað");

  try {
    const client = new SkrivaClient(skrivaConfig(env));
    const statuses = [];
    for (const row of rows) {
      const status = await client.signingStatus(row.signer_token!);
      statuses.push({ row, status });
      await env.DB
        .prepare(
          `UPDATE onboarding_signing
           SET status = ?2, p_tal = COALESCE(?3, p_tal), last_polled_at_ms = ?4,
               provider_status_json = ?5
           WHERE id = ?1`,
        )
        .bind(
          row.id,
          status.state,
          status.personalIdentificationNumber,
          Date.now(),
          JSON.stringify(status.raw),
        )
        .run();
    }

    const selectedOwnerIds = new Set(
      pack.owners.filter((owner) => owner.is_signatory).map((owner) => owner.id),
    );
    const fullySigned =
      statuses.length === selectedOwnerIds.size &&
      statuses.every(
        ({ row, status }) =>
          status.state === "signed" &&
          Boolean(row.owner_id) &&
          selectedOwnerIds.has(row.owner_id!),
      );
    const alreadyStored = pack.events.some((event) => event.kind === "skriva_signed");
    if (fullySigned && !alreadyStored) {
      const first = rows[0]!;
      const requestId = Number(first.signing_request_id);
      if (!Number.isInteger(requestId)) throw new SkrivaError("Ógilt Skriva-nummar");
      const pdf = await client.downloadSignedPdf(requestId, first.signer_token!);
      if (!first.document_instance_id) {
        throw new SkrivaError("Skjalatilvísingin hjá Skriva manglar");
      }
      await storeSignedDocumentInstance(
        env.DB,
        env.DOCUMENTS,
        first.document_instance_id,
        pdf,
      );
      await putDocument(env.DB, {
        applicationId: id,
        kind: "agreement",
        fileName: "kortinnloysing-fo-undirskrivad.pdf",
        contentType: "application/pdf",
        bytes: pdf,
        uploadedBy: "skriva",
      }, { bucket: env.DOCUMENTS });
      const at = Date.now();
      await env.DB
        .prepare(
          `UPDATE onboarding_application
           SET state = 'pack_ready', updated_at_ms = ?2
           WHERE id = ?1`,
        )
        .bind(id, at)
        .run();
      await recordEvent(env.DB, id, "skriva_signed", actor.email, {
        signingRequestId: requestId,
      }, () => at);
      return redirect(message(back, "sent", "skriva_signed"));
    }

    return redirect(message(back, "sent", "skriva_status"));
  } catch (error) {
    console.error(JSON.stringify({
      event: "skriva_status_failed",
      applicationId: id,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return fail(
      error instanceof SkrivaError
        ? error.message
        : "Støðan hjá Skriva fekst ikki. Royn aftur.",
    );
  }
};
