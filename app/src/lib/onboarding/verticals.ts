/**
 * Curated verticals a merchant can pick.
 *
 * The prohibited-list PDF is not transcribed. Until it is, this is a short list
 * staff can also override by hand — not a self-serve catalogue of every Swedbank line.
 */

export type VerticalSector = 0 | 1 | 2;

export interface Vertical {
  key: string;
  label: string;
  hint: string;
  sector: VerticalSector;
}

export const VERTICALS: readonly Vertical[] = [
  {
    key: "cafe",
    label: "Kaffihús og matstova",
    hint: "Matur, kaffi, drykkur á staðnum",
    sector: 0,
  },
  {
    key: "retail",
    label: "Handil",
    hint: "Vanlig vøra, ikki serlig áhætta",
    sector: 0,
  },
  {
    key: "services",
    label: "Tænasta",
    hint: "Salg, verkstað, ráðgeving",
    sector: 0,
  },
  {
    key: "travel",
    label: "Ferðing og uppihald",
    hint: "Geiri 2 — hægri prís og eyka skjøl",
    sector: 2,
  },
  {
    key: "supplements",
    label: "Kostískoyti",
    hint: "Geiri 2 — hægri prís og eyka skjøl",
    sector: 2,
  },
  {
    key: "gambling",
    label: "Spæl og betting",
    hint: "Geiri 1 — Swedbank tekur ikki ímóti",
    sector: 1,
  },
  {
    key: "crypto",
    label: "Krypto og virtuell gjaldoyra",
    hint: "Geiri 1 — Swedbank tekur ikki ímóti",
    sector: 1,
  },
  {
    key: "adult",
    label: "Vaksin innihald",
    hint: "Geiri 1 — Swedbank tekur ikki ímóti",
    sector: 1,
  },
] as const;

export function verticalByKey(key: string | null | undefined): Vertical | null {
  if (!key) return null;
  return VERTICALS.find((item) => item.key === key) ?? null;
}
