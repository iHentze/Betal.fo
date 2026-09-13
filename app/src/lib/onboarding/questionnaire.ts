import { answerValue, type ApplicationPack } from "./application";

export const BUSINESS_REQUIRED_ANSWERS = [
  "annual_card_turnover_dkk",
  "average_transaction_dkk",
  "market_name",
  "contact_name",
  "contact_phone",
  "contact_email",
  "invoice_email",
  "product_type",
  "inventory",
  "delivery_method",
  "delivery_days",
  "subscriptions",
  "gift_cards",
  "primary_customers",
  "payment_link_mode",
  "save_card",
  "wallets",
  "other_mit",
  "website_terms",
  "made_to_order",
  "sales_regions",
] as const;

export type BusinessAnswerKey = (typeof BUSINESS_REQUIRED_ANSWERS)[number];

export interface SalesRegions {
  denmark: number;
  nordics: number;
  eu: number;
  usa: number;
  other: number;
}

export function salesRegionsTotal(regions: SalesRegions | null): number {
  if (!regions) return 0;
  return regions.denmark + regions.nordics + regions.eu + regions.usa + regions.other;
}

export function businessAnswersComplete(pack: ApplicationPack): boolean {
  for (const key of BUSINESS_REQUIRED_ANSWERS) {
    const value = answerValue<unknown>(pack, key);
    if (value === null || value === "" || value === undefined) return false;
  }
  const annual = answerValue<number>(pack, "annual_card_turnover_dkk");
  const average = answerValue<number>(pack, "average_transaction_dkk");
  const deliveryDays = answerValue<number>(pack, "delivery_days");
  if (
    !Number.isFinite(annual) ||
    Number(annual) <= 0 ||
    !Number.isFinite(average) ||
    Number(average) <= 0 ||
    !Number.isFinite(deliveryDays) ||
    Number(deliveryDays) < 0
  ) {
    return false;
  }
  if (salesRegionsTotal(answerValue<SalesRegions>(pack, "sales_regions")) !== 100) {
    return false;
  }
  if (answerValue<boolean>(pack, "made_to_order")) {
    const fields = [
      answerValue<number>(pack, "made_to_order_days"),
      answerValue<number>(pack, "made_to_order_share_percent"),
    ];
    if (fields.some((value) => !Number.isFinite(value) || Number(value) < 0)) return false;
    if (answerValue<boolean>(pack, "deposit")) {
      const depositShare = answerValue<number>(pack, "deposit_share_percent");
      if (!Number.isFinite(depositShare) || Number(depositShare) <= 0) return false;
    }
    if (
      !answerValue<string>(pack, "final_payment_when") ||
      !answerValue<string>(pack, "final_payment_method")
    ) return false;
  }
  if (
    answerValue<boolean>(pack, "save_card") &&
    answerValue<boolean>(pack, "save_card_in_app") === null
  ) return false;
  if (
    answerValue<boolean>(pack, "donations") &&
    answerValue<boolean>(pack, "donations_supervised") === null
  ) return false;
  return true;
}

function numberField(form: FormData, key: string): number {
  const value = Number(String(form.get(key) ?? "").replace(",", "."));
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

function booleanField(form: FormData, key: string): boolean {
  const value = String(form.get(key) ?? "");
  if (value !== "yes" && value !== "no") throw new Error(`${key} is required`);
  return value === "yes";
}

export function businessAnswersFromForm(form: FormData): Record<string, unknown> {
  const requiredStrings = [
    "market_name",
    "contact_name",
    "contact_phone",
    "contact_email",
    "invoice_email",
    "product_type",
    "inventory",
    "delivery_method",
    "primary_customers",
    "payment_link_mode",
  ] as const;
  const strings = Object.fromEntries(
    requiredStrings.map((key) => {
      const value = String(form.get(key) ?? "").trim();
      if (!value) throw new Error(`${key} is required`);
      return [key, value];
    }),
  );
  const regions: SalesRegions = {
    denmark: numberField(form, "sales_denmark"),
    nordics: numberField(form, "sales_nordics"),
    eu: numberField(form, "sales_eu"),
    usa: numberField(form, "sales_usa"),
    other: numberField(form, "sales_other"),
  };
  if (salesRegionsTotal(regions) !== 100) {
    throw new Error("Sales regions must add up to 100%");
  }

  const madeToOrder = booleanField(form, "made_to_order");
  const saveCard = booleanField(form, "save_card");
  const saveCardInAppValue = String(form.get("save_card_in_app") ?? "");
  if (saveCard && !saveCardInAppValue) {
    throw new Error("saved-card app answer is required");
  }
  const donations = booleanField(form, "donations");
  const donationsSupervisedValue = String(form.get("donations_supervised") ?? "");
  if (donations && !donationsSupervisedValue) {
    throw new Error("donation supervision answer is required");
  }
  const finalPaymentWhen = String(form.get("final_payment_when") ?? "").trim();
  const finalPaymentMethod = String(form.get("final_payment_method") ?? "").trim();
  if (madeToOrder && (!finalPaymentWhen || !finalPaymentMethod)) {
    throw new Error("made-to-order payment details are required");
  }
  return {
    ...strings,
    annual_card_turnover_dkk: numberField(form, "annual_card_turnover_dkk"),
    average_transaction_dkk: numberField(form, "average_transaction_dkk"),
    delivery_days: numberField(form, "delivery_days"),
    subscriptions: booleanField(form, "subscriptions"),
    donations,
    donations_supervised: donationsSupervisedValue
      ? booleanField(form, "donations_supervised")
      : null,
    gift_cards: booleanField(form, "gift_cards"),
    save_card: saveCard,
    save_card_in_app: saveCardInAppValue
      ? booleanField(form, "save_card_in_app")
      : null,
    wallets: form.getAll("wallets").map(String),
    other_mit: booleanField(form, "other_mit"),
    website_terms: booleanField(form, "website_terms"),
    made_to_order: madeToOrder,
    made_to_order_days: madeToOrder
      ? numberField(form, "made_to_order_days")
      : null,
    made_to_order_share_percent: madeToOrder
      ? numberField(form, "made_to_order_share_percent")
      : null,
    deposit: madeToOrder ? booleanField(form, "deposit") : false,
    deposit_share_percent:
      madeToOrder && String(form.get("deposit") ?? "") === "yes"
        ? numberField(form, "deposit_share_percent")
        : null,
    final_payment_when: madeToOrder ? finalPaymentWhen : null,
    final_payment_method: madeToOrder ? finalPaymentMethod : null,
    wallet_other: String(form.get("wallet_other") ?? "").trim() || null,
    sales_regions: regions,
  };
}
