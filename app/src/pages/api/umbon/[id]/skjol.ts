import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import {
  isDocumentKind,
  MAX_DOCUMENT_BYTES,
  putDocument,
  validateDocumentUpload,
} from "~/lib/onboarding/documents";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals, url }) => {
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

  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  const step = String(form.get("step") ?? "skjol");
  const file = form.get("file");
  const back = wizardPath(id, step === "banki" ? "banki" : step === "undirskriva" ? "undirskriva" : "skjol", actor, pack.application.merchant_id);

  const fail = (message: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${back}${back.includes("?") ? "&" : "?"}feilur=${encodeURIComponent(message)}` },
    });

  if (!isDocumentKind(kind)) return fail("Ókent skjalaslag");
  if (!(file instanceof File) || file.size === 0) return fail("Vel eina fílu");
  if (file.size > MAX_DOCUMENT_BYTES) return fail("Fílan er ov stór (í mesta lagi 10 MB)");

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const contentType = validateDocumentUpload(
      file.name,
      file.type || "application/octet-stream",
      bytes,
    );
    await putDocument(env.DB, {
      applicationId: id,
      kind,
      fileName: file.name,
      contentType,
      bytes,
      uploadedBy: actor.email,
    }, { bucket: env.DOCUMENTS });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  return new Response(null, { status: 303, headers: { Location: back } });
};
