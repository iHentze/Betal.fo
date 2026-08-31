/**
 * Money. Every amount in the product is formatted and converted here.
 *
 * ePay uses two incompatible representations and mixing them is the single easiest way
 * to produce a wrong invoice:
 *
 *   * transactions and operations are integer minor units — 1095 is 10,95 DKK
 *   * settlements are decimal strings — "99.01" — which must never be parsed as a
 *     float, because binary floating point cannot represent most decimal fractions
 *     exactly and the error compounds across a settlement report
 *
 * Everything internal is therefore integer minor units, and decimal strings are
 * converted through exact string arithmetic rather than `parseFloat`.
 *
 * Formatting is Faroese/Danish convention — "1.234,56" — implemented directly rather
 * than through Intl so results are identical in Node and workerd regardless of the ICU
 * data each ships.
 */

/** Faroese VAT (meirvirðisgjald), currently 25%. */
export const MVG_RATE_BASIS_POINTS = 2500;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Converts a decimal string to integer minor units without floating point.
 *
 * Accepts an optional sign, an optional fractional part of any length, and rejects
 * anything else rather than silently coercing. More than two decimal places is an
 * error rather than a rounding decision, so an unexpected settlement format surfaces
 * instead of quietly losing money.
 */
export function decimalToMinor(value: string, scale = 2): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MoneyError(`Expected a decimal string, received ${JSON.stringify(value)}`);
  }

  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`Malformed decimal string: ${JSON.stringify(value)}`);
  }

  const [, sign, whole, fraction = ""] = match;

  if (fraction.length > scale) {
    throw new MoneyError(
      `Decimal string ${JSON.stringify(value)} has more than ${scale} decimal places`,
    );
  }

  const padded = fraction.padEnd(scale, "0");
  const minor = Number(`${whole}${padded}`);

  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Decimal string ${JSON.stringify(value)} is out of range`);
  }

  return sign === "-" ? -minor : minor;
}

/** Converts integer minor units back to a decimal string. */
export function minorToDecimal(minor: number, scale = 2): string {
  if (!Number.isInteger(minor)) {
    throw new MoneyError(`Expected integer minor units, received ${minor}`);
  }

  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Sums decimal strings exactly, by converting to minor units first. */
export function sumDecimals(values: readonly string[], scale = 2): string {
  const total = values.reduce((sum, value) => sum + decimalToMinor(value, scale), 0);
  return minorToDecimal(total, scale);
}

/**
 * Groups the integer part with periods and separates the decimal with a comma, which
 * is Faroese and Danish convention: 1234567 minor units renders as "12.345,67".
 */
function groupDigits(digits: string): string {
  let grouped = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ".";
    grouped += digits[i];
  }
  return grouped;
}

export interface FormatOptions {
  /** Append the ISO currency code. Codes, never symbols. */
  currency?: string | undefined;
  /** Render a leading + on positives, for adjustments and deltas. */
  signed?: boolean;
  /** Drop the decimals — used only for chart axes and coarse summaries. */
  whole?: boolean;
}

/** Formats integer minor units for display. */
export function formatMinor(
  minor: number,
  options: FormatOptions = {},
): string {
  if (!Number.isFinite(minor)) return "—";

  const negative = minor < 0;
  const absolute = Math.abs(Math.trunc(minor));
  const digits = absolute.toString().padStart(3, "0");
  const whole = digits.slice(0, digits.length - 2);
  const fraction = digits.slice(digits.length - 2);

  let rendered = options.whole
    ? groupDigits(whole)
    : `${groupDigits(whole)},${fraction}`;

  if (negative) rendered = `−${rendered}`;
  else if (options.signed) rendered = `+${rendered}`;

  return options.currency ? `${rendered} ${options.currency}` : rendered;
}

/** Formats a settlement decimal string for display, without going via a float. */
export function formatDecimal(value: string, options: FormatOptions = {}): string {
  return formatMinor(decimalToMinor(value), options);
}

// ---------------------------------------------------------------------------
// VAT
// ---------------------------------------------------------------------------

export interface VatBreakdown {
  /** Amount before VAT, in minor units. */
  net: number;
  /** VAT charged, in minor units. */
  vat: number;
  /** Total payable, in minor units. */
  gross: number;
  rateBasisPoints: number;
}

/**
 * Adds VAT to a net amount.
 *
 * Rounds half away from zero at the line level. Banker's rounding would be defensible
 * too, but half-up matches what a Faroese accountant checking the invoice by hand will
 * arrive at, and matching the human is worth more than statistical neutrality here.
 */
export function addVat(
  netMinor: number,
  rateBasisPoints = MVG_RATE_BASIS_POINTS,
): VatBreakdown {
  if (!Number.isInteger(netMinor)) {
    throw new MoneyError(`Expected integer minor units, received ${netMinor}`);
  }

  const scaled = netMinor * rateBasisPoints;
  const vat =
    scaled >= 0
      ? Math.floor((scaled + 5000) / 10000)
      : -Math.floor((-scaled + 5000) / 10000);

  return {
    net: netMinor,
    vat,
    gross: netMinor + vat,
    rateBasisPoints,
  };
}

/** Extracts the VAT already contained in a gross amount. */
export function extractVat(
  grossMinor: number,
  rateBasisPoints = MVG_RATE_BASIS_POINTS,
): VatBreakdown {
  if (!Number.isInteger(grossMinor)) {
    throw new MoneyError(`Expected integer minor units, received ${grossMinor}`);
  }

  const divisor = 10000 + rateBasisPoints;
  const scaled = grossMinor * 10000;
  const net =
    scaled >= 0
      ? Math.floor((scaled + divisor / 2) / divisor)
      : -Math.floor((-scaled + divisor / 2) / divisor);

  return {
    net,
    vat: grossMinor - net,
    gross: grossMinor,
    rateBasisPoints,
  };
}

/**
 * Multiplies a minor amount by a rate in basis points, rounding half away from zero.
 *
 * Used by the rating engine for percentage price rules, where the result must be
 * reproducible: the same inputs must always give the same line, because an invoice is
 * regenerated whenever a client disputes it.
 */
export function applyBasisPoints(minor: number, basisPoints: number): number {
  const scaled = minor * basisPoints;
  return scaled >= 0
    ? Math.floor((scaled + 5000) / 10000)
    : -Math.floor((-scaled + 5000) / 10000);
}

/** Formats a rate in basis points as a percentage: 250 renders as "2,5 %". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  if (fraction === 0) return `${whole} %`;
  const rendered = fraction % 10 === 0 ? String(fraction / 10) : String(fraction).padStart(2, "0");
  return `${whole},${rendered} %`;
}
