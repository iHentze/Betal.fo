import { fo } from "~/content/fo";
import type { Actor } from "./auth";
import type { NavSection } from "~/layouts/AppLayout.astro";

/**
 * Navigation, filtered by who is looking.
 *
 * A merchant sees their own business. Betal staff see the operating tools as well.
 * The same list feeds the command palette, so anything reachable by clicking is
 * reachable by typing.
 */
/**
 * Navigation, filtered by who is looking.
 *
 * Staff see the Betal tools plus, once they have picked a merchant, that merchant's
 * own screens with the selection carried through the links. Before they have picked
 * one those screens have nothing to show, so they are left out rather than offered
 * and then failing.
 */
export function navFor(
  actor: Actor,
  selectedMerchantId?: string | null,
): NavSection[] {
  const scope = actor.kind === "staff" && selectedMerchantId
    ? `?handil=${selectedMerchantId}`
    : "";

  const merchant: NavSection = {
    label: actor.kind === "staff" ? "Handilin" : undefined,
    items: [
      { label: fo.nav.overview, href: `/${scope}`, icon: "overview" },
      { label: fo.nav.transactions, href: `/gjaldingar${scope}`, icon: "transactions" },
      { label: fo.nav.settlements, href: `/avrokningar${scope}`, icon: "settlements" },
      { label: fo.nav.links, href: `/gjaldsleinki${scope}`, icon: "links" },
      { label: fo.nav.invoices, href: `/rokningar${scope}`, icon: "invoices" },
      { label: fo.nav.settings, href: `/stillingar${scope}`, icon: "settings" },
    ],
  };

  const betal: NavSection = {
    label: "Betal",
    items: [
      { label: fo.nav.merchants, href: "/betal/handlar", icon: "merchants" },
      { label: fo.nav.periods, href: "/betal/tidarskeid", icon: "periods" },
      { label: fo.nav.margin, href: "/betal/vinningur", icon: "margin" },
      { label: fo.nav.applications, href: "/betal/umbonir", icon: "applications" },
      { label: fo.nav.prices, href: "/betal/prislistar", icon: "prices" },
      { label: fo.nav.leads, href: "/betal/ahugadir", icon: "leads" },
      { label: fo.nav.support, href: "/betal/studul", icon: "support" },
      { label: fo.nav.design, href: "/betal/snid", icon: "design" },
    ],
  };

  if (actor.kind !== "staff") return [merchant];
  return selectedMerchantId ? [betal, merchant] : [betal];
}

/** Sums a group of rows, so a day header can carry the day's takings. */
export function sumAmounts<T extends { amount: number; state?: string }>(
  rows: T[],
  onlySuccessful = true,
): number {
  return rows.reduce(
    (total, row) =>
      onlySuccessful && row.state && row.state !== "SUCCESS"
        ? total
        : total + row.amount,
    0,
  );
}

/** Formats a timestamp for a dense list row: short, and stable across locales. */
export function formatDateTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}. ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** Age for a queue row: "3 t" / "2 dagar", always tabular. */
export function formatAge(fromMs: number, nowMs: number = Date.now()): string {
  const delta = Math.max(0, nowMs - fromMs);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} t`;
  return `${Math.floor(hours / 24)} dagar`;
}

/** Groups rows by calendar day, which is how a merchant reads their takings. */
export function groupByDay<T extends { created_at_ms: number }>(
  rows: T[],
): Array<{ label: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const date = new Date(row.created_at_ms);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
      date.getUTCDate(),
    ).padStart(2, "0")}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return Array.from(groups.entries()).map(([key, groupRows]) => {
    const [year, month, day] = key.split("-");
    return { label: `${day}.${month}.${year}`, rows: groupRows };
  });
}
