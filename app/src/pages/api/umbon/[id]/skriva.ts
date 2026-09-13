import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import { getActivePriceList, recordEvent } from "~/lib/onboarding/application";
import { canSendToSkriva, fillAgreementPdf } from "~/lib/onboarding/pdf";
import { priceListKind, screenApplication } from "~/lib/onboarding/screening";
import { SkrivaClient, SkrivaError, skrivaConfig, skrivaConfigured } from "~/lib/onboarding/skriva";
import { getOfficialTemplate } from "~/lib/onboarding/swedbank";
import { createFinalSnapshot, getActivePolicy } from "~/lib/onboarding/snapshot";
import { createDocumentInstance } from "~/lib/onboarding/document-instances";

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

  const alreadyOpen = pack.signings.find(
    (signing) =>
      signing.provider === "skriva" &&
      (signing.status === "sent" || signing.status === "viewed") &&
      signing.signing_url,
  );
  if (alreadyOpen?.signing_url) {
    return actor.kind === "merchant"
      ? redirect(alreadyOpen.signing_url)
      : redirect(message(back, "sent", "skriva"));
  }
  if (pack.application.state === "signing") {
    await env.DB
      .prepare(
        `UPDATE onboarding_application
         SET state = 'ready_for_signing', updated_at_ms = ?2
         WHERE id = ?1 AND state = 'signing'`,
      )
      .bind(id, Date.now())
      .run();
  }

  const signerOwners = pack.owners.filter((owner) => owner.is_signatory);
  if (signerOwners.length === 0) return fail("Í minsta lagi ein undirskrivari manglar");
  if (signerOwners.some((owner) => !owner.email)) {
    return fail("Teldupostur manglar hjá einum undirskrivara");
  }

  const screening = screenApplication({
    sector: pack.application.vertical_sector,
    equity: pack.application.equity as "positive" | "negative" | "unknown" | null,
    operations: pack.application.operations as "positive" | "negative" | "unknown" | null,
  });
  const priceList = await getActivePriceList(env.DB, priceListKind(screening));
  const allowed = canSendToSkriva(pack, priceList, skrivaConfigured(env));
  if (!allowed.ok) return fail(allowed.reason);

  let official: Awaited<ReturnType<typeof getOfficialTemplate>>;
  let snapshot: Awaited<ReturnType<typeof createFinalSnapshot>>;
  try {
    const policy = await getActivePolicy(env.DB);
    if (!policy) return fail("Eingin góðkend onboarding-regla er virkin");
    official = await getOfficialTemplate(env.DB, env.DOCUMENTS, "agreement");
    snapshot = await createFinalSnapshot(env.DB, {
      pack,
      policyId: policy.id,
      priceList,
      agreementTemplate: official.template,
      actorEmail: actor.email,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Umsóknin kundi ikki gerast klár");
  }

  const previousState = "ready_for_signing";
  const locked = await env.DB
    .prepare(
      `UPDATE onboarding_application
       SET state = 'signing', updated_at_ms = ?2
       WHERE id = ?1 AND state != 'signing'`,
    )
    .bind(id, Date.now())
    .run();
  if ((locked.meta.changes ?? 0) === 0) {
    return fail("Undirskriftin verður longu stovnað. Royn aftur um eina løtu.");
  }

  try {
    const pdf = await fillAgreementPdf(pack, priceList, official.bytes);
    const instance = await createDocumentInstance(env.DB, env.DOCUMENTS, {
      applicationId: id,
      templateId: official.template.id,
      snapshotId: snapshot.id,
      kind: "agreement",
      state: "final",
      bytes: pdf,
      createdBy: actor.email,
    });
    const now = Date.now();
    const expires = new Date(now + 14 * 86_400_000).toISOString();
    const reminder = new Date(now + 7 * 86_400_000).toISOString();
    const redirectUrl = new URL(
      `/umbon/${id}/undirskriva`,
      env.APP_URL,
    ).toString();
    const client = new SkrivaClient(skrivaConfig(env));
    const request = await client.createSigningRequest({
      signers: signerOwners.map((owner) => ({
        name: owner.name,
        email: owner.email!,
      })),
      pdf,
      title: `Kortinnloysing · ${pack.application.legal_name}`,
      redirectUrl,
      emailText:
        "Betal hevur gjørt FO-avtaluna klára. Les avtaluna og undirskriva trygt við Samleikanum.",
      expirationDate: expires,
      reminderDate: reminder,
    });

    const statements = request.signers.map((signer, index) =>
      env.DB
        .prepare(
          `INSERT INTO onboarding_signing (
             id, application_id, provider, environment, signing_request_id,
             signer_token, signing_url, p_tal, status, created_at_ms, owner_id,
             signing_person_id, document_instance_id, expires_at_ms
           ) VALUES (?1, ?2, 'skriva', ?3, ?4, ?5, ?6, ?7, 'sent', ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          env.SKRIVA_BASE_URL?.includes("azurewebsites.net") ? "staging" : "production",
          String(request.signingRequestId),
          signer.token,
          signer.signingUrl,
          signer.personalIdentificationNumber,
          now,
          signerOwners[index]!.id,
          signer.signingPersonId,
          instance.id,
          Date.parse(expires),
        )
    );
    await env.DB.batch(statements);
    await recordEvent(env.DB, id, "skriva_sent", actor.email, {
      signingRequestId: request.signingRequestId,
      signerCount: request.signers.length,
    }, () => now);

    const actorIndex = signerOwners.findIndex(
      (owner) => owner.email?.toLowerCase() === actor.email.toLowerCase(),
    );
    if (actor.kind === "merchant" && actorIndex >= 0) {
      return redirect(request.signers[actorIndex]!.signingUrl);
    }
    return redirect(message(back, "sent", "skriva"));
  } catch (error) {
    await env.DB
      .prepare(
        `UPDATE onboarding_application
         SET state = ?2, updated_at_ms = ?3
         WHERE id = ?1 AND state = 'signing'`,
      )
      .bind(id, previousState, Date.now())
      .run();
    console.error(JSON.stringify({
      event: "skriva_create_failed",
      applicationId: id,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return fail(
      error instanceof SkrivaError
        ? error.message
        : "Skriva kundi ikki stovna undirskriftina. Royn aftur.",
    );
  }
};
