import { describe, expect, it } from "vitest";
import {
  isBillable,
  parsePricePlan,
  ratePeriod,
  ratingFingerprint,
  RatingError,
} from "~/lib/billing/rating";
import type {
  BillableTransaction,
  PeriodContext,
  PricePlan,
  PriceRule,
} from "~/lib/billing/types";

const context: PeriodContext = {
  merchantId: "m1",
  year: 2026,
  month: 8,
  startsAtMs: Date.UTC(2026, 7, 1),
  endsAtMs: Date.UTC(2026, 8, 1),
  pointOfSaleCount: 2,
  terminalCount: 3,
};

function plan(rules: PriceRule[], overrides: Partial<PricePlan> = {}): PricePlan {
  return {
    id: "plan-1",
    merchantId: "m1",
    name: "Standard",
    version: 1,
    currency: "DKK",
    billableStates: ["SUCCESS"],
    billableTypes: ["PAYMENT"],
    billRefunds: false,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    rules,
    ...overrides,
  };
}

function transactions(
  count: number,
  amountMinor = 10_000,
  overrides: Partial<BillableTransaction> = {},
): BillableTransaction[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `T${String(index + 1).padStart(3, "0")}`,
    state: "SUCCESS",
    type: "PAYMENT",
    amount: amountMinor,
    currency: "DKK",
    createdAtMs: Date.UTC(2026, 7, 15) + index,
    pointOfSaleId: "pos1",
    ...overrides,
  }));
}

describe("billability", () => {
  it("counts only the states and types the plan allows", () => {
    const p = plan([]);
    expect(isBillable(p, transactions(1)[0]!)).toBe(true);
    expect(isBillable(p, { ...transactions(1)[0]!, state: "FAILED" })).toBe(false);
    expect(isBillable(p, { ...transactions(1)[0]!, type: "PAYOUT" })).toBe(false);
  });

  it("excludes non-billable transactions from every line", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_transaction",
          label: "Gjald per gjalding",
          params: { amountMinor: 50 },
        },
      ]),
      [
        ...transactions(3),
        { ...transactions(1)[0]!, id: "FAILED1", state: "FAILED" },
        { ...transactions(1)[0]!, id: "PAYOUT1", type: "PAYOUT" },
      ],
      context,
    );

    expect(result.billableCount).toBe(3);
    expect(result.lines[0]!.amountMinor).toBe(150);
    expect(result.lines[0]!.inputs.map((i) => i.transactionId)).not.toContain("FAILED1");
  });
});

describe("per-transaction pricing", () => {
  it("charges the fixed fee for each billable transaction", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_transaction",
          label: "Gjald per gjalding",
          params: { amountMinor: 50 },
        },
      ]),
      transactions(120),
      context,
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.quantity).toBe(120);
    expect(result.lines[0]!.amountMinor).toBe(6_000);
    expect(result.netMinor).toBe(6_000);
  });

  it("records every counted transaction so the figure can be explained", () => {
    // The line has to be traceable to the transactions behind it, because "why is
    // this 1.247 kr?" is the question clients actually ask.
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_transaction",
          label: "Gjald per gjalding",
          params: { amountMinor: 50 },
        },
      ]),
      transactions(5),
      context,
    );

    const inputs = result.lines[0]!.inputs;
    expect(inputs).toHaveLength(5);
    expect(inputs.map((i) => i.transactionId)).toEqual([
      "T001",
      "T002",
      "T003",
      "T004",
      "T005",
    ]);
    expect(inputs.reduce((sum, i) => sum + (i.amountMinor ?? 0), 0)).toBe(
      result.lines[0]!.amountMinor,
    );
  });

  it("produces no line at all when nothing was billable", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_transaction",
          label: "Gjald per gjalding",
          params: { amountMinor: 50 },
        },
      ]),
      [],
      context,
    );

    expect(result.lines).toHaveLength(0);
    expect(result.netMinor).toBe(0);
    expect(result.grossMinor).toBe(0);
  });
});

describe("percentage pricing", () => {
  it("applies the rate per transaction and sums", () => {
    // 1,4% of 250,00 is 3,50 each.
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "percentage",
          label: "Prosent av umsetningi",
          params: { basisPoints: 140 },
        },
      ]),
      transactions(4, 250_00),
      context,
    );

    expect(result.lines[0]!.amountMinor).toBe(4 * 350);
    expect(result.lines[0]!.basisPoints).toBe(140);
  });

  it("rounds each transaction rather than the aggregate", () => {
    // Three transactions of 0,03 at 50%: each rounds to 0,02, so 0,06 — not the 0,05
    // that rounding the 0,09 aggregate would give. The per-transaction figures are
    // what a client can check.
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "percentage",
          label: "Prosent",
          params: { basisPoints: 5000 },
        },
      ]),
      transactions(3, 3),
      context,
    );

    expect(result.lines[0]!.amountMinor).toBe(6);
    for (const input of result.lines[0]!.inputs) {
      expect(input.amountMinor).toBe(2);
    }
  });
});

describe("tiered pricing", () => {
  const tiered: PriceRule = {
    id: "r1",
    position: 1,
    kind: "tiered_per_transaction",
    label: "Trappuprísur",
    params: {
      bands: [
        { upTo: 100, amountMinor: 100 },
        { upTo: 500, amountMinor: 75 },
        { amountMinor: 50 },
      ],
    },
  };

  it("prices each band separately rather than repricing everything", () => {
    // 600 transactions: 100 at 1,00 + 400 at 0,75 + 100 at 0,50.
    const result = ratePeriod(plan([tiered]), transactions(600), context);
    expect(result.lines[0]!.amountMinor).toBe(100 * 100 + 400 * 75 + 100 * 50);
  });

  it("stays inside the first band for a small merchant", () => {
    const result = ratePeriod(plan([tiered]), transactions(40), context);
    expect(result.lines[0]!.amountMinor).toBe(40 * 100);
  });

  it("prices exactly at a band boundary", () => {
    const result = ratePeriod(plan([tiered]), transactions(100), context);
    expect(result.lines[0]!.amountMinor).toBe(100 * 100);
  });

  it("rejects a plan whose bands do not cover the volume", () => {
    const capped: PriceRule = {
      ...tiered,
      params: { bands: [{ upTo: 10, amountMinor: 100 }] },
    };
    // A configuration error, not something to silently absorb.
    expect(() => ratePeriod(plan([capped]), transactions(50), context)).toThrow(
      RatingError,
    );
  });
});

describe("fixed and per-unit rules", () => {
  it("charges a monthly fee even with no transactions", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "monthly_fixed",
          label: "Gáttargjald",
          params: { amountMinor: 199_00 },
        },
      ]),
      [],
      context,
    );

    expect(result.netMinor).toBe(199_00);
  });

  it("charges per point of sale beyond those included", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_point_of_sale",
          label: "Eyka sølustað",
          params: { amountMinor: 50_00, includedUnits: 1 },
        },
      ]),
      [],
      context,
    );

    // Two points of sale, one included.
    expect(result.lines[0]!.quantity).toBe(1);
    expect(result.netMinor).toBe(50_00);
  });

  it("charges nothing when everything is included", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_terminal",
          label: "Terminalur",
          params: { amountMinor: 25_00, includedUnits: 5 },
        },
      ]),
      [],
      context,
    );

    expect(result.lines).toHaveLength(0);
  });
});

describe("minimum", () => {
  const rules: PriceRule[] = [
    {
      id: "r1",
      position: 1,
      kind: "per_transaction",
      label: "Gjald per gjalding",
      params: { amountMinor: 50 },
    },
    {
      id: "r2",
      position: 2,
      kind: "minimum",
      label: "Minstagjald",
      params: { amountMinor: 150_00 },
    },
  ];

  it("tops the invoice up to the floor", () => {
    // 100 transactions at 0,50 is 50,00, so 100,00 short of the 150,00 minimum.
    const result = ratePeriod(plan(rules), transactions(100), context);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]!.amountMinor).toBe(100_00);
    expect(result.netMinor).toBe(150_00);
  });

  it("adds nothing once the floor is cleared", () => {
    const result = ratePeriod(plan(rules), transactions(400), context);
    expect(result.lines).toHaveLength(1);
    expect(result.netMinor).toBe(200_00);
  });

  it("respects rule order when deciding the shortfall", () => {
    // A monthly fee ordered before the minimum counts towards it.
    const withMonthly = ratePeriod(
      plan([
        {
          id: "r0",
          position: 0,
          kind: "monthly_fixed",
          label: "Gáttargjald",
          params: { amountMinor: 120_00 },
        },
        ...rules,
      ]),
      transactions(10),
      context,
    );

    // 120,00 + 5,00 = 125,00, so the top-up is 25,00.
    expect(withMonthly.netMinor).toBe(150_00);
    expect(withMonthly.lines.at(-1)!.amountMinor).toBe(25_00);
  });
});

describe("VAT", () => {
  it("adds 25% MVG to the net total", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "monthly_fixed",
          label: "Gáttargjald",
          params: { amountMinor: 200_00 },
        },
      ]),
      [],
      context,
    );

    expect(result.netMinor).toBe(200_00);
    expect(result.vatMinor).toBe(50_00);
    expect(result.grossMinor).toBe(250_00);
  });

  it("keeps net plus VAT equal to gross", () => {
    const result = ratePeriod(
      plan([
        {
          id: "r1",
          position: 1,
          kind: "per_transaction",
          label: "Gjald",
          params: { amountMinor: 37 },
        },
      ]),
      transactions(931),
      context,
    );

    expect(result.netMinor + result.vatMinor).toBe(result.grossMinor);
  });
});

describe("determinism", () => {
  const complexPlan = plan([
    {
      id: "r1",
      position: 1,
      kind: "monthly_fixed",
      label: "Gáttargjald",
      params: { amountMinor: 149_00 },
    },
    {
      id: "r2",
      position: 2,
      kind: "per_transaction",
      label: "Gjald per gjalding",
      params: { amountMinor: 45 },
    },
    {
      id: "r3",
      position: 3,
      kind: "percentage",
      label: "Prosent",
      params: { basisPoints: 90 },
    },
    {
      id: "r4",
      position: 4,
      kind: "minimum",
      label: "Minstagjald",
      params: { amountMinor: 250_00 },
    },
  ]);

  it("produces an identical result on every run", () => {
    // An invoice is regenerated whenever a client disputes it; the second answer must
    // match the first exactly.
    const input = transactions(377, 187_43);
    const first = ratePeriod(complexPlan, input, context);
    const fingerprint = ratingFingerprint(first);

    for (let i = 0; i < 50; i += 1) {
      expect(ratingFingerprint(ratePeriod(complexPlan, input, context))).toBe(
        fingerprint,
      );
    }
  });

  it("is unaffected by the order rules were stored in", () => {
    const shuffled = plan([...complexPlan.rules].reverse());
    const input = transactions(200, 99_95);

    expect(ratingFingerprint(ratePeriod(complexPlan, input, context))).toBe(
      ratingFingerprint(ratePeriod(shuffled, input, context)),
    );
  });

  it("changes fingerprint when the inputs change", () => {
    const a = ratePeriod(complexPlan, transactions(100), context);
    const b = ratePeriod(complexPlan, transactions(101), context);
    expect(ratingFingerprint(a)).not.toBe(ratingFingerprint(b));
  });
});

describe("parsePricePlan", () => {
  it("reads a stored plan and its rules", () => {
    const parsed = parsePricePlan(
      {
        id: "plan-1",
        merchant_id: "m1",
        name: "Standard",
        version: 2,
        currency: "DKK",
        billable_states: '["SUCCESS"]',
        billable_types: '["PAYMENT"]',
        bill_refunds: 0,
        effective_from: "2026-01-01",
        effective_to: null,
      },
      [
        {
          id: "r1",
          position: 1,
          kind: "per_transaction",
          label: "Gjald",
          params: '{"amountMinor":50}',
        },
      ],
    );

    expect(parsed.version).toBe(2);
    expect(parsed.billableStates).toEqual(["SUCCESS"]);
    expect(parsed.billRefunds).toBe(false);
    expect(parsed.rules[0]!.params).toEqual({ amountMinor: 50 });
  });
});
