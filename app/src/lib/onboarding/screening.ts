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
  refuseSwedbank: boolean;
  reason: string;
}

export function screenApplication(input: ScreeningInput): ScreeningResult {
  if (input.sector === 1) {
    return {
      recommended: "clearhaus",
      extraDocs: false,
      refuseSwedbank: true,
      reason: "Geiri 1 — bannað vinnugrein hjá Swedbank",
    };
  }

  if (input.equity === "negative") {
    return {
      recommended: "clearhaus",
      extraDocs: false,
      refuseSwedbank: true,
      reason: "Negativ eginogn — Swedbank rindar brutto og tekur ikki ímóti",
    };
  }

  if (input.operations === "negative") {
    return {
      recommended: "clearhaus",
      extraDocs: false,
      refuseSwedbank: true,
      reason: "Negativ drift — Swedbank rindar brutto og tekur ikki ímóti",
    };
  }

  if (input.sector === 2) {
    return {
      recommended: "swedbank",
      extraDocs: true,
      refuseSwedbank: false,
      reason: "Geiri 2 — Swedbank við hægri prísi og eyka skjølum",
    };
  }

  return {
    recommended: "swedbank",
    extraDocs: false,
    refuseSwedbank: false,
    reason: "Vanlig vinnugrein, einki raut flagg",
  };
}

export function priceListKind(result: ScreeningResult): "standard" | "sector2" {
  return result.extraDocs ? "sector2" : "standard";
}
