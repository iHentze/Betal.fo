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
export function navFor(actor: Actor): NavSection[] {
  const merchant: NavSection = {
    items: [
      { label: fo.nav.overview, href: "/", icon: "overview" },
      { label: fo.nav.transactions, href: "/gjaldingar", icon: "transactions" },
      { label: fo.nav.settlements, href: "/avrokningar", icon: "settlements" },
      { label: fo.nav.links, href: "/gjaldsleinki", icon: "links" },
      { label: fo.nav.invoices, href: "/rokningar", icon: "invoices" },
      { label: fo.nav.settings, href: "/stillingar", icon: "settings" },
    ],
  };

  if (actor.kind !== "staff") return [merchant];

  return [
    merchant,
    {
      label: "Betal",
      items: [
        { label: fo.nav.merchants, href: "/betal/handlar", icon: "merchants" },
        { label: fo.nav.periods, href: "/betal/tidarskeid", icon: "periods" },
        { label: fo.nav.margin, href: "/betal/vinningur", icon: "margin" },
        { label: fo.nav.leads, href: "/betal/ahugadir", icon: "leads" },
        { label: fo.nav.support, href: "/betal/studul", icon: "support" },
      ],
    },
  ];
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
