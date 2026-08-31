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
      { label: fo.nav.overview, href: "/" },
      { label: fo.nav.transactions, href: "/gjaldingar" },
      { label: fo.nav.settlements, href: "/avrokningar" },
      { label: fo.nav.links, href: "/gjaldsleinki" },
      { label: fo.nav.invoices, href: "/rokningar" },
      { label: fo.nav.settings, href: "/stillingar" },
    ],
  };

  if (actor.kind !== "staff") return [merchant];

  return [
    merchant,
    {
      label: "Betal",
      items: [
        { label: fo.nav.merchants, href: "/betal/handlar" },
        { label: fo.nav.periods, href: "/betal/tidarskeid" },
        { label: fo.nav.margin, href: "/betal/vinningur" },
        { label: fo.nav.leads, href: "/betal/ahugadir" },
        { label: fo.nav.support, href: "/betal/studul" },
      ],
    },
  ];
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
