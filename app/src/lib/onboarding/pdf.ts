import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  StandardFonts,
  rgb,
} from "pdf-lib";
import {
  answerValue,
  priceListHasRates,
  type ApplicationPack,
  type PriceList,
} from "./application";
import { businessAnswersComplete, type SalesRegions } from "./questionnaire";
import { canGenerateSwedbankAgreement } from "./steps";
import { sha256 } from "./documents";
import { parseOfficialRates } from "./official-rates";
import {
  AGREEMENT_CHECKBOX_FIELDS,
  AGREEMENT_CHECKBOX_PLACEMENTS,
  AGREEMENT_TEXT_FIELDS,
  BANK_CONFIRMATION_FIELDS,
  PRICE_CATEGORIES,
  PRICE_FIELD_COLUMNS,
  SWEDBANK_TEMPLATE_HASHES,
} from "./swedbank";

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function yesNo(value: boolean | null): string {
  return value ? "Ja" : "Nej";
}

function formatDkk(value: number): string {
  return new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMinor(value: number): string {
  return new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(2).replace(".", ",")}%`;
}

function splitAccount(value: string): { registration: string; account: string } {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return { registration: digits, account: "" };
  return { registration: digits.slice(0, 4), account: digits.slice(4) };
}

function setText(
  form: ReturnType<PDFDocument["getForm"]>,
  name: string,
  value: string | number | null | undefined,
): void {
  const field = form.getField(name);
  if (!(field instanceof PDFTextField)) throw new Error(`${name} is not a text field`);
  field.setText(value == null ? "" : String(value));
}

function setChecked(
  form: ReturnType<PDFDocument["getForm"]>,
  name: string,
  checked: boolean,
): void {
  const field = form.getField(name);
  if (!(field instanceof PDFCheckBox)) throw new Error(`${name} is not a checkbox`);
  if (checked) field.check();
  else field.uncheck();
}

async function assertTemplate(
  bytes: Uint8Array,
  expectedHash: string,
  label: string,
): Promise<void> {
  if (await sha256(bytes) !== expectedHash) {
    throw new Error(`${label}: skjalið samsvarar ikki við góðkenda útgávu`);
  }
}

export function canFillAgreement(
  pack: ApplicationPack,
): { ok: true } | { ok: false; reason: string } {
  if (!canGenerateSwedbankAgreement(pack)) {
    return {
      ok: false,
      reason: "Vit gera ikki eina Swedbank-avtalu, tá ið tilmælið ikki er Swedbank.",
    };
  }
  const app = pack.application;
  if (app.country_code !== "FO") {
    return { ok: false, reason: "Landakoda má vera FO." };
  }
  if (
    !app.legal_name ||
    !app.v_tal ||
    !app.address_line_one ||
    !app.postal_code ||
    !app.city ||
    !app.website ||
    !app.sells
  ) {
    return {
      ok: false,
      reason: "Felagsnavn, V-tal, adressa og vinnuupplýsingar mugu vera sett.",
    };
  }
  if (!businessAnswersComplete(pack)) {
    return { ok: false, reason: "Vinnu- og søluupplýsingar mangla." };
  }
  const signers = pack.owners.filter((owner) => owner.is_signatory);
  if (signers.length === 0 || signers.some((owner) => !owner.email)) {
    return { ok: false, reason: "Undirskrivari og teldupostur mangla." };
  }
  return { ok: true };
}

export function canSendToSkriva(
  pack: ApplicationPack,
  priceList: PriceList | null,
  skrivaReady: boolean,
): { ok: true } | { ok: false; reason: string } {
  const fill = canFillAgreement(pack);
  if (!fill.ok) return fill;
  if (!priceListHasRates(priceList) || !parseOfficialRates(priceList?.rates_json)) {
    return {
      ok: false,
      reason: "Príslistin er ikki settur. Vit senda ikki eina avtalu uttan FO-prísir.",
    };
  }
  if (!skrivaReady) {
    return {
      ok: false,
      reason: "Skriva-brúkari er ikki settur.",
    };
  }
  return { ok: true };
}

export async function fillAgreementPdf(
  pack: ApplicationPack,
  priceList: PriceList | null,
  templateBytes: Uint8Array,
): Promise<Uint8Array> {
  const check = canFillAgreement(pack);
  if (!check.ok) throw new Error(check.reason);
  const rates = parseOfficialRates(priceList?.rates_json);
  if (!rates) throw new Error("Góðkendur FO-príslisti manglar");
  await assertTemplate(
    templateBytes,
    SWEDBANK_TEMPLATE_HASHES.agreement,
    "Kortinnloysingaravtala",
  );

  const app = pack.application;
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regions = answerValue<SalesRegions>(pack, "sales_regions")!;
  const account = splitAccount(app.bank_account ?? "");
  const contactName = answerValue<string>(pack, "contact_name") ?? "";
  const contactParts = contactName.trim().split(/\s+/);

  const values: Array<[string, string | number | null | undefined]> = [
    [AGREEMENT_TEXT_FIELDS.legalName, app.legal_name],
    [AGREEMENT_TEXT_FIELDS.vTal, app.v_tal],
    [AGREEMENT_TEXT_FIELDS.postalAddress, [app.address_line_one, app.address_line_two].filter(Boolean).join(", ")],
    [AGREEMENT_TEXT_FIELDS.postalCode, app.postal_code],
    [AGREEMENT_TEXT_FIELDS.city, app.city],
    [AGREEMENT_TEXT_FIELDS.contactName, contactName],
    [AGREEMENT_TEXT_FIELDS.contactPhone, answerValue<string>(pack, "contact_phone")],
    [AGREEMENT_TEXT_FIELDS.contactEmail, answerValue<string>(pack, "contact_email")],
    [AGREEMENT_TEXT_FIELDS.invoiceEmail, answerValue<string>(pack, "invoice_email")],
    [AGREEMENT_TEXT_FIELDS.marketName, answerValue<string>(pack, "market_name")],
    [AGREEMENT_TEXT_FIELDS.website, app.website],
    [AGREEMENT_TEXT_FIELDS.productDescription, app.sells],
    [AGREEMENT_TEXT_FIELDS.annualCardTurnover, `${formatDkk(answerValue<number>(pack, "annual_card_turnover_dkk")!)} DKK`],
    [AGREEMENT_TEXT_FIELDS.averagePurchase, `${formatDkk(answerValue<number>(pack, "average_transaction_dkk")!)} DKK`],
    [AGREEMENT_TEXT_FIELDS.salesDenmarkPercent, regions.denmark],
    [AGREEMENT_TEXT_FIELDS.salesNordicsPercent, regions.nordics],
    [AGREEMENT_TEXT_FIELDS.salesEuPercent, regions.eu],
    [AGREEMENT_TEXT_FIELDS.salesUsaPercent, regions.usa],
    [AGREEMENT_TEXT_FIELDS.salesOtherPercent, regions.other],
    [AGREEMENT_TEXT_FIELDS.deliveryMethod, answerValue<string>(pack, "delivery_method")],
    [AGREEMENT_TEXT_FIELDS.deliveryDays, answerValue<number>(pack, "delivery_days")],
    [AGREEMENT_TEXT_FIELDS.savedCardInApp, yesNo(answerValue<boolean>(pack, "save_card_in_app"))],
    [AGREEMENT_TEXT_FIELDS.otherWallet, answerValue<string>(pack, "wallet_other")],
    [AGREEMENT_TEXT_FIELDS.recurringPayments, yesNo(answerValue<boolean>(pack, "subscriptions"))],
    [AGREEMENT_TEXT_FIELDS.otherMit, yesNo(answerValue<boolean>(pack, "other_mit"))],
    [AGREEMENT_TEXT_FIELDS.websiteTerms, yesNo(answerValue<boolean>(pack, "website_terms"))],
    [AGREEMENT_TEXT_FIELDS.madeToOrder, yesNo(answerValue<boolean>(pack, "made_to_order"))],
    [AGREEMENT_TEXT_FIELDS.madeToOrderDelivery, answerValue<number>(pack, "made_to_order_days")],
    [AGREEMENT_TEXT_FIELDS.madeToOrderShare, answerValue<number>(pack, "made_to_order_share_percent")],
    [AGREEMENT_TEXT_FIELDS.deposit, yesNo(answerValue<boolean>(pack, "deposit"))],
    [AGREEMENT_TEXT_FIELDS.depositShare, answerValue<number>(pack, "deposit_share_percent")],
    [AGREEMENT_TEXT_FIELDS.finalPaymentWhen, answerValue<string>(pack, "final_payment_when")],
    [AGREEMENT_TEXT_FIELDS.finalPaymentMethod, answerValue<string>(pack, "final_payment_method")],
    [AGREEMENT_TEXT_FIELDS.dkkRegistrationNumber, account.registration],
    [AGREEMENT_TEXT_FIELDS.dkkAccountNumber, account.account],
    [AGREEMENT_TEXT_FIELDS.portalUserFirstName, contactParts[0] ?? ""],
    [AGREEMENT_TEXT_FIELDS.portalUserLastName, contactParts.slice(1).join(" ")],
    [AGREEMENT_TEXT_FIELDS.portalUserEmail, answerValue<string>(pack, "contact_email")],
    [AGREEMENT_TEXT_FIELDS.establishmentFee, formatMinor(rates.establishmentFeeMinor)],
    [AGREEMENT_TEXT_FIELDS.monthlyFee, formatMinor(rates.monthlyFeeMinor)],
    [AGREEMENT_TEXT_FIELDS.minimumMonthlyPayment, formatMinor(rates.minimumMonthlyPaymentMinor)],
    [AGREEMENT_TEXT_FIELDS.priceCategory, rates.priceCategory],
  ];
  for (const [name, value] of values) setText(form, name, value);

  const selectedCheckboxes: string[] = [];
  const checkBox = (name: string, selected: boolean) => {
    setChecked(form, name, selected);
    if (selected) selectedCheckboxes.push(name);
  };
  const paymentMode = answerValue<string>(pack, "payment_link_mode");
  checkBox(AGREEMENT_CHECKBOX_FIELDS.paymentLinkNone, paymentMode === "none");
  checkBox(AGREEMENT_CHECKBOX_FIELDS.paymentLinkHtml, paymentMode === "html");
  checkBox(AGREEMENT_CHECKBOX_FIELDS.paymentLinkDigital, paymentMode === "digital");
  checkBox(AGREEMENT_CHECKBOX_FIELDS.paymentLinkPhysical, paymentMode === "physical");
  const wallets = answerValue<string[]>(pack, "wallets") ?? [];
  checkBox(AGREEMENT_CHECKBOX_FIELDS.walletMobilePay, wallets.includes("mobilepay"));
  checkBox(AGREEMENT_CHECKBOX_FIELDS.walletApplePay, wallets.includes("applepay"));
  checkBox(AGREEMENT_CHECKBOX_FIELDS.walletGooglePay, wallets.includes("googlepay"));
  checkBox(AGREEMENT_CHECKBOX_FIELDS.pspEpay, true);
  checkBox(AGREEMENT_CHECKBOX_FIELDS.hosted, true);
  checkBox(AGREEMENT_CHECKBOX_FIELDS.handlesCardData, false);
  checkBox(AGREEMENT_CHECKBOX_FIELDS.threeDSecure, true);
  checkBox(AGREEMENT_CHECKBOX_FIELDS.cvvRequired, true);

  for (const [index, category] of PRICE_CATEGORIES.entries()) {
    const rate = rates.cardRates[category]!;
    setText(form, PRICE_FIELD_COLUMNS.visaTransaction[index]!, formatMinor(rate.visa.transactionMinor));
    setText(form, PRICE_FIELD_COLUMNS.visaPercent[index]!, formatBasisPoints(rate.visa.basisPoints));
    setText(form, PRICE_FIELD_COLUMNS.mastercardTransaction[index]!, formatMinor(rate.mastercard.transactionMinor));
    setText(form, PRICE_FIELD_COLUMNS.mastercardPercent[index]!, formatBasisPoints(rate.mastercard.basisPoints));
    setText(form, PRICE_FIELD_COLUMNS.dinersTransaction[index]!, formatMinor(rate.diners.transactionMinor));
    setText(form, PRICE_FIELD_COLUMNS.dinersPercent[index]!, formatBasisPoints(rate.diners.basisPoints));
  }

  form.updateFieldAppearances(font);
  form.flatten();
  for (const fieldName of selectedCheckboxes) {
    const placement = AGREEMENT_CHECKBOX_PLACEMENTS[fieldName];
    if (!placement) throw new Error(`${fieldName}: checkbox placement is not mapped`);
    pdf.getPages()[placement.page]!.drawText("X", {
      x: placement.x - 0.25,
      y: placement.y - 0.75,
      size: 6.5,
      font: bold,
      color: rgb(0, 0, 0),
    });
  }

  // The supplied FO filename still has a static “Danmark” in Swedbank’s notes.
  // This coordinate is hash-pinned to Oneflow ID 12465631 and must never be reused
  // with another template revision.
  const notesPage = pdf.getPages()[4]!;
  notesPage.drawRectangle({
    x: 220,
    y: 588,
    width: 42,
    height: 12,
    color: rgb(1, 1, 1),
  });
  notesPage.drawText("FO", { x: 223, y: 590, size: 7, font, color: rgb(0, 0, 0) });
  pdf.setTitle(`Kortindløsning Online · ${text(app.legal_name)} · FO`);
  pdf.setSubject(`Swedbank Pay FO · ${text(app.v_tal)}`);
  pdf.setProducer("Betal");
  return pdf.save();
}

export async function fillBankFormPdf(
  pack: ApplicationPack,
  templateBytes: Uint8Array,
): Promise<Uint8Array> {
  const app = pack.application;
  if (!app.legal_name || !app.v_tal || !app.bank_account) {
    throw new Error("Felagsnavn, V-tal og kontunummar mangla");
  }
  await assertTemplate(
    templateBytes,
    SWEDBANK_TEMPLATE_HASHES.bankConfirmation,
    "Bankaváttan",
  );
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const account = splitAccount(app.bank_account);

  for (const name of Object.values(BANK_CONFIRMATION_FIELDS)) {
    const field = form.getField(name);
    if (field instanceof PDFTextField) field.setFontSize(10);
  }
  setText(form, BANK_CONFIRMATION_FIELDS.legalName, app.legal_name);
  setText(form, BANK_CONFIRMATION_FIELDS.vTal, app.v_tal);
  setText(form, BANK_CONFIRMATION_FIELDS.registrationNumber, account.registration);
  setText(form, BANK_CONFIRMATION_FIELDS.accountNumber, account.account);
  // Date and signature/stamp are intentionally left for the bank.
  setText(form, BANK_CONFIRMATION_FIELDS.bankDate, "");
  form.updateFieldAppearances(font);
  form.flatten();
  pdf.setTitle(`Bekræftelse af konto · ${app.legal_name}`);
  pdf.setProducer("Betal");
  return pdf.save();
}
