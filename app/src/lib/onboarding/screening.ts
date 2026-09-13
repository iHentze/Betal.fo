/**
 * Acquirer recommendation.
 *
 * Same rule as rating: given the same inputs, the same recommendation. Staff can
 * override, but the override is an event, not a silent edit. We never generate a
 * Swedbank agreement for a merchant this function has already flagged off Swedbank.
 */

export type Acquirer = "swedbank" | "clearhaus" | "shift4" | "decline";
export type FinanceFlag = "positive" | "negative" | "unknown";

export interface ScreeningInput {
  sector: number | null;
  equity: FinanceFlag | null;
  operations: FinanceFlag | null;
}

export interface ScreeningResult {
  recommended: Acquirer;
  extraDocs: boolean;
  priceList: "standard" | "sector2";
  refuseSwedbank: boolean;
  reason: string;
}

export function deriveSectorFromAnswers(
  baseSector: number,
  answers: Record<string, unknown>,
): number {
  // Unsupervised donations are explicitly sector 1 in the pinned Swedbank policy.
  if (answers.donations === true && answers.donations_supervised !== true) return 1;
  if (answers.donations === true) return Math.max(baseSector, 2);
  // Gift/prepaid cards and digitally delivered goods are sector 2.
  if (
    answers.gift_cards === true ||
    answers.product_type === "digital" ||
    answers.product_type === "both"
  ) return Math.max(baseSector, 2);
  return baseSector;
}

export function screenApplication(input: ScreeningInput): ScreeningResult {
  if (input.sector === 1) {
    return {
      recommended: "clearhaus",
      extraDocs: false,
      priceList: "standard",
      refuseSwedbank: true,
      reason: "Geiri 1 — bannað vinnugrein hjá Swedbank",
    };
  }

  if (input.equity === "negative") {
    return {
      recommended: "clearhaus",
      extraDocs: false,
      priceList: "standard",
      refuseSwedbank: true,
      reason: "Negativ eginogn — Swedbank rindar brutto og tekur ikki ímóti",
    };
  }

  if (input.operations === "negative") {
    return {
      recommended: "clearhaus",
      extraDocs: false,
      priceList: "standard",
      refuseSwedbank: true,
      reason: "Negativ drift — Swedbank rindar brutto og tekur ikki ímóti",
    };
  }

  if (input.sector === 2) {
    return {
      recommended: "swedbank",
      extraDocs: true,
      priceList: "sector2",
      refuseSwedbank: false,
      reason: "Geiri 2 — Swedbank við hægri prísi og eyka skjølum",
    };
  }

  if (input.equity === "unknown" || input.operations === "unknown") {
    return {
      recommended: "swedbank",
      extraDocs: true,
      priceList: "standard",
      refuseSwedbank: false,
      reason: "Óviss roknskapartøl — ársroknskapur krevst til skoðan",
    };
  }

  return {
    recommended: "swedbank",
    extraDocs: false,
    priceList: "standard",
    refuseSwedbank: false,
    reason: "Vanlig vinnugrein, einki raut flagg",
  };
}

export function priceListKind(result: ScreeningResult): "standard" | "sector2" {
  return result.priceList;
}
