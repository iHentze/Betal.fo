import { PRICE_CATEGORIES } from "./swedbank";

export interface SchemeRate {
  transactionMinor: number;
  basisPoints: number;
}

export interface OfficialRateSet {
  establishmentFeeMinor: number;
  monthlyFeeMinor: number;
  minimumMonthlyPaymentMinor: number;
  priceCategory: string;
  cardRates: Record<
    string,
    {
      visa: SchemeRate;
      mastercard: SchemeRate;
      diners: SchemeRate;
    }
  >;
}

export const PRICE_SCHEMES = ["visa", "mastercard", "diners"] as const;
export type PriceScheme = (typeof PRICE_SCHEMES)[number];
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];

export const PRICE_CATEGORY_LABELS: Record<PriceCategory, string> = {
  dk_debit: "DK debit",
  dk_credit: "DK kredit",
  dk_corporate: "DK fyritøka",
  eu_debit: "EU debit",
  eu_credit: "EU kredit",
  eu_corporate: "EU fyritøka",
  non_eu_debit: "Utan EU debit",
  non_eu_credit: "Utan EU kredit",
  non_eu_corporate: "Utan EU fyritøka",
};

function isSchemeRate(value: unknown): value is SchemeRate {
  if (!value || typeof value !== "object") return false;
  const rate = value as SchemeRate;
  return (
    Number.isFinite(rate.transactionMinor) &&
    rate.transactionMinor >= 0 &&
    Number.isFinite(rate.basisPoints) &&
    rate.basisPoints >= 0
  );
}

export function parseOfficialRates(
  input: string | OfficialRateSet | null | undefined,
): OfficialRateSet | null {
  if (!input) return null;
  try {
    const value = (typeof input === "string" ? JSON.parse(input) : input) as OfficialRateSet;
    if (
      !value ||
      typeof value !== "object" ||
      !value.cardRates ||
      typeof value.priceCategory !== "string" ||
      !value.priceCategory.trim() ||
      !Number.isFinite(value.establishmentFeeMinor) ||
      value.establishmentFeeMinor < 0 ||
      !Number.isFinite(value.monthlyFeeMinor) ||
      value.monthlyFeeMinor < 0 ||
      !Number.isFinite(value.minimumMonthlyPaymentMinor) ||
      value.minimumMonthlyPaymentMinor < 0
    ) {
      return null;
    }
    for (const category of PRICE_CATEGORIES) {
      const row = value.cardRates[category];
      if (
        !row ||
        !isSchemeRate(row.visa) ||
        !isSchemeRate(row.mastercard) ||
        !isSchemeRate(row.diners)
      ) {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

export function priceListHasOfficialRates(ratesJson: string | null | undefined): boolean {
  return parseOfficialRates(ratesJson) !== null;
}

export function officialRateFieldName(
  category: string,
  scheme: PriceScheme,
  part: "txn" | "pct",
): string {
  return `rate__${category}__${scheme}__${part}`;
}

function parseDecimal(value: string, label: string): number {
  const parsed = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} má vera eitt positivt tal`);
  }
  return parsed;
}

function minorFromDkk(value: string, label: string): number {
  return Math.round(parseDecimal(value, label) * 100);
}

function bpsFromPercent(value: string, label: string): number {
  return Math.round(parseDecimal(value, label) * 100);
}

export function dkkFromMinor(value: number): string {
  return (value / 100).toFixed(2).replace(".", ",");
}

export function percentFromBps(value: number): string {
  return (value / 100).toFixed(2).replace(".", ",");
}

export function officialRatesFromForm(form: FormData): OfficialRateSet {
  const pasted = String(form.get("rates_json") ?? "").trim();
  if (pasted) {
    const parsed = parseOfficialRates(pasted);
    if (!parsed) throw new Error("Prísa JSON-ið er ikki eitt fullfíggjað FO-skjal");
    return parsed;
  }

  const cardRates = Object.fromEntries(
    PRICE_CATEGORIES.map((category) => {
      const row = Object.fromEntries(
        PRICE_SCHEMES.map((scheme) => {
          const label = `${PRICE_CATEGORY_LABELS[category]} ${scheme}`;
          return [
            scheme,
            {
              transactionMinor: minorFromDkk(
                String(form.get(officialRateFieldName(category, scheme, "txn")) ?? ""),
                `${label} DKK`,
              ),
              basisPoints: bpsFromPercent(
                String(form.get(officialRateFieldName(category, scheme, "pct")) ?? ""),
                `${label} %`,
              ),
            },
          ];
        }),
      );
      return [category, row];
    }),
  ) as OfficialRateSet["cardRates"];

  const priceCategory = String(form.get("price_category") ?? "").trim();
  if (!priceCategory) throw new Error("Prísbólkur manglar");

  return {
    establishmentFeeMinor: minorFromDkk(
      String(form.get("establishment_fee") ?? ""),
      "Stovnargjald",
    ),
    monthlyFeeMinor: minorFromDkk(String(form.get("monthly_fee") ?? ""), "Mánaðargjald"),
    minimumMonthlyPaymentMinor: minorFromDkk(
      String(form.get("minimum_monthly") ?? ""),
      "Minsta mánaðargjald",
    ),
    priceCategory,
    cardRates,
  };
}

export function formValuesFromOfficialRates(
  rates: OfficialRateSet | null,
): Record<string, string> {
  if (!rates) return {};
  const values: Record<string, string> = {
    establishment_fee: dkkFromMinor(rates.establishmentFeeMinor),
    monthly_fee: dkkFromMinor(rates.monthlyFeeMinor),
    minimum_monthly: dkkFromMinor(rates.minimumMonthlyPaymentMinor),
    price_category: rates.priceCategory,
  };
  for (const category of PRICE_CATEGORIES) {
    const row = rates.cardRates[category];
    if (!row) continue;
    for (const scheme of PRICE_SCHEMES) {
      values[officialRateFieldName(category, scheme, "txn")] = dkkFromMinor(
        row[scheme].transactionMinor,
      );
      values[officialRateFieldName(category, scheme, "pct")] = percentFromBps(
        row[scheme].basisPoints,
      );
    }
  }
  return values;
}
