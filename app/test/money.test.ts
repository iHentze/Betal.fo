import { describe, expect, it } from "vitest";
import {
  addVat,
  applyBasisPoints,
  decimalToMinor,
  extractVat,
  formatBasisPoints,
  formatDecimal,
  formatMinor,
  minorToDecimal,
  MoneyError,
  sumDecimals,
} from "~/lib/money";

describe("decimalToMinor", () => {
  it("converts settlement decimal strings exactly", () => {
    expect(decimalToMinor("99.01")).toBe(9901);
    expect(decimalToMinor("100")).toBe(10_000);
    expect(decimalToMinor("0.05")).toBe(5);
    expect(decimalToMinor("-1.20")).toBe(-120);
    expect(decimalToMinor("0")).toBe(0);
  });

  it("handles values a float would round wrongly", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; going through integers avoids it.
    expect(decimalToMinor("0.1") + decimalToMinor("0.2")).toBe(decimalToMinor("0.3"));
    expect(decimalToMinor("1234567.89")).toBe(123_456_789);
  });

  it("rejects malformed input rather than coercing it", () => {
    expect(() => decimalToMinor("")).toThrow(MoneyError);
    expect(() => decimalToMinor("abc")).toThrow(MoneyError);
    expect(() => decimalToMinor("1,20")).toThrow(MoneyError);
    expect(() => decimalToMinor("1.2.3")).toThrow(MoneyError);
    expect(() => decimalToMinor(undefined as unknown as string)).toThrow(MoneyError);
  });

  it("rejects more precision than the scale allows instead of silently rounding", () => {
    // An unexpected settlement format should surface, not quietly lose a fraction.
    expect(() => decimalToMinor("1.005")).toThrow(MoneyError);
  });

  it("round-trips through minorToDecimal", () => {
    for (const value of ["0.00", "1.00", "99.01", "-1.20", "1234567.89"]) {
      expect(minorToDecimal(decimalToMinor(value))).toBe(value);
    }
  });
});

describe("sumDecimals", () => {
  it("sums acquirer fees exactly", () => {
    // The three fee types from a settlement transaction.
    expect(sumDecimals(["-1.20", "-0.85", "-0.40"])).toBe("-2.45");
  });

  it("sums a long run without drift", () => {
    const values = Array.from({ length: 1000 }, () => "0.01");
    expect(sumDecimals(values)).toBe("10.00");
  });

  it("returns zero for an empty list", () => {
    expect(sumDecimals([])).toBe("0.00");
  });
});

describe("formatMinor", () => {
  it("uses Faroese grouping and decimal separators", () => {
    expect(formatMinor(123_456)).toBe("1.234,56");
    expect(formatMinor(100)).toBe("1,00");
    expect(formatMinor(5)).toBe("0,05");
    expect(formatMinor(0)).toBe("0,00");
    expect(formatMinor(123_456_789)).toBe("1.234.567,89");
  });

  it("appends the currency as a code rather than a symbol", () => {
    expect(formatMinor(123_456, { currency: "DKK" })).toBe("1.234,56 DKK");
  });

  it("renders negatives with a true minus sign", () => {
    expect(formatMinor(-2_45)).toBe("−2,45");
  });

  it("can render an explicit plus for deltas", () => {
    expect(formatMinor(500, { signed: true })).toBe("+5,00");
    expect(formatMinor(-500, { signed: true })).toBe("−5,00");
  });

  it("returns a placeholder rather than NaN", () => {
    expect(formatMinor(Number.NaN)).toBe("—");
  });

  it("formats a settlement decimal string identically to minor units", () => {
    expect(formatDecimal("1234.56")).toBe(formatMinor(123_456));
  });
});

describe("VAT at the Faroese rate", () => {
  it("adds 25% MVG", () => {
    const result = addVat(100_00);
    expect(result.net).toBe(100_00);
    expect(result.vat).toBe(25_00);
    expect(result.gross).toBe(125_00);
  });

  it("rounds half away from zero, matching a hand calculation", () => {
    // 10,01 * 0,25 = 2,5025 -> 2,50
    expect(addVat(10_01).vat).toBe(250);
    // 0,02 * 0,25 = 0,005 -> 0,01 rather than 0,00
    expect(addVat(2).vat).toBe(1);
  });

  it("extracts VAT from a gross amount", () => {
    const result = extractVat(125_00);
    expect(result.net).toBe(100_00);
    expect(result.vat).toBe(25_00);
  });

  it("keeps net plus vat equal to gross for a range of values", () => {
    for (let net = 0; net < 5000; net += 7) {
      const added = addVat(net);
      expect(added.net + added.vat).toBe(added.gross);

      const extracted = extractVat(added.gross);
      expect(extracted.net + extracted.vat).toBe(added.gross);
    }
  });

  it("rejects fractional minor units", () => {
    expect(() => addVat(10.5)).toThrow(MoneyError);
  });
});

describe("applyBasisPoints", () => {
  it("computes a percentage fee reproducibly", () => {
    // 1,4% of 250,00 = 3,50
    expect(applyBasisPoints(250_00, 140)).toBe(350);
  });

  it("rounds half away from zero in both directions", () => {
    // 0,5 rounds to 1 rather than 0.
    expect(applyBasisPoints(1, 5000)).toBe(1);
    expect(applyBasisPoints(-1, 5000)).toBe(-1);
  });

  it("is deterministic across repeated evaluation", () => {
    // Rating must replay identically, so this can never depend on float order.
    const values = [1_00, 33_33, 999_99, 12_345_67];
    for (const value of values) {
      const first = applyBasisPoints(value, 175);
      for (let i = 0; i < 100; i += 1) {
        expect(applyBasisPoints(value, 175)).toBe(first);
      }
    }
  });
});

describe("formatBasisPoints", () => {
  it("renders whole and fractional rates", () => {
    expect(formatBasisPoints(200)).toBe("2 %");
    expect(formatBasisPoints(250)).toBe("2,5 %");
    expect(formatBasisPoints(175)).toBe("1,75 %");
  });
});
