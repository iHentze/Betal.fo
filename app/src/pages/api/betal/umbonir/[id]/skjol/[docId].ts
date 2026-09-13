import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { getDocumentById } from "~/lib/onboarding/documents";
import { toArrayBuffer } from "~/lib/onboarding/bytes";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = locals.actor;
  if (!actor || actor.kind !== "staff") {
    return new Response("forbidden", { status: 403 });
  }

  const id = params.id;
  const docId = params.docId;
  if (!id || !docId) return new Response("not found", { status: 404 });

  const doc = await getDocumentById(env.DB, id, docId);
  if (!doc?.bytes) return new Response("not found", { status: 404 });

  const body = doc.bytes instanceof Uint8Array ? doc.bytes : new Uint8Array(doc.bytes);
  return new Response(toArrayBuffer(body), {
    headers: {
      "Content-Type": doc.content_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.file_name ?? "skjal"}"`,
    },
  });
};
