/**
 * Merchant verticals, including the versioned Swedbank prohibited-list keys.
 *
 * Sector 0 is Betal's common Faroese set. Sectors 1 and 2 use the keys seeded from
 * `Prohibited lines of business.pdf` in onboarding_sector_rule.
 */

export type VerticalSector = 0 | 1 | 2;

export interface Vertical {
  key: string;
  label: string;
  hint: string;
  sector: VerticalSector;
}

export interface VerticalGroup {
  sector: VerticalSector;
  title: string;
  items: readonly Vertical[];
}

const STANDARD: readonly Vertical[] = [
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
];

const SECTOR_TWO: readonly Vertical[] = [
  { key: "travel", label: "Ferðastovur og flogfeløg", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "hotel", label: "Gistingarhús", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "car-rental", label: "Bilaleiga", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "supplements", label: "Kostískoyti", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "medical", label: "Heilivágur og heilsuvørur", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "medical-devices", label: "Heilivágstól", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "online-alcohol", label: "Nettasøla av alkoholi", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "online-tobacco", label: "Nettasøla av tobakki", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "online-gambling", label: "Nettaspæl", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "online-gaming", label: "Spøl á netinum", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "online-lotteries", label: "Nettalotteri", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "digital-goods", label: "Talgildar vørur", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "digital-wallets", label: "Talgildar veskur", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "cloud-hosting", label: "Skýggja- og fílahýsing", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "event-tickets", label: "Tiltaksatgongumerki", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "gift-prepaid-cards", label: "Gávukort og forútgoldin kort", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "deals", label: "Tilboðs- og avsláttarportalar", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "dating-chat", label: "Kjatt og dating", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "real-estate-rental", label: "Leiga av ognum", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "furniture", label: "Møblar", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "pawn-antiques", label: "Pant og antikvitetir", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "capital-goods", label: "Íløguvørur", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "financial-services", label: "Fíggjartænastur", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "organisations", label: "Politisk og trúarlig feløg", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "restricted-trade", label: "Út- og innflutningur við avmarkingum", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "sport-weapons", label: "Ítróttarvápn", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
  { key: "descramblers", label: "Sjónvarps-descramblarar", hint: "Geiri 2 — hægri prís og eyka skjøl", sector: 2 },
];

const SECTOR_ONE: readonly Vertical[] = [
  { key: "crypto", label: "Krypto og virtuell gjaldoyra", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "nft", label: "NFT", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "adult", label: "Vaksin innihald", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "money-services", label: "Pengatænastur og veksling", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "mlm", label: "Pýramida- og fleirstigssøla", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "illegal-goods", label: "Ólógiligar vørur", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "unsecured-package-travel", label: "Pakkafærð uttan trygd", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "unregulated-charity", label: "Gáva uttan eftirlit", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "crowdfunding", label: "Fjøldafíggjan", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "social-platform-sales", label: "Søla á sosialum miðlum", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "anonymity-services", label: "VPN og dulnevni", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
  { key: "illegal-wildlife", label: "Ólógilig villini", hint: "Geiri 1 — Swedbank tekur ikki ímóti", sector: 1 },
];

export const VERTICAL_GROUPS: readonly VerticalGroup[] = [
  { sector: 0, title: "Vanlig vinnugrein", items: STANDARD },
  { sector: 2, title: "Geiri 2 — Swedbank við hægri prísi", items: SECTOR_TWO },
  { sector: 1, title: "Geiri 1 — ikki Swedbank", items: SECTOR_ONE },
];

export const FEATURED_VERTICALS: readonly Vertical[] = STANDARD;

export const VERTICALS: readonly Vertical[] = VERTICAL_GROUPS.flatMap((group) => group.items);

export function verticalByKey(key: string | null | undefined): Vertical | null {
  if (!key) return null;
  return VERTICALS.find((item) => item.key === key) ?? null;
}

export function isFeaturedVertical(key: string | null | undefined): boolean {
  return Boolean(key && FEATURED_VERTICALS.some((item) => item.key === key));
}
