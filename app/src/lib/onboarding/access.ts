import type { Actor } from "../auth";
import { scopeToMerchant } from "../auth";
import type { Database } from "../db/types";
import { loadPack, type ApplicationPack } from "./application";

export function handilQuery(actor: Actor, merchantId: string): string {
  return actor.kind === "staff" ? `?handil=${merchantId}` : "";
}

export function wizardPath(
  applicationId: string,
  slug: string,
  actor: Actor,
  merchantId: string,
): string {
  return `/umbon/${applicationId}/${slug}${handilQuery(actor, merchantId)}`;
}

export async function requirePack(
  db: Database,
  actor: Actor,
  applicationId: string,
  requestedMerchant: string | null,
): Promise<ApplicationPack> {
  const pack = await loadPack(db, applicationId);
  if (!pack) throw new Error("not_found");
  const scoped = scopeToMerchant(actor, requestedMerchant ?? pack.application.merchant_id);
  if (scoped !== pack.application.merchant_id) throw new Error("forbidden");
  return pack;
}
