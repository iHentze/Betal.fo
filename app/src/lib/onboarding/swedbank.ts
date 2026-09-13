import type { Database, ObjectBucket } from "../db/types";
import { sha256 } from "./documents";

export const SWEDBANK_TEMPLATE_HASHES = {
  agreement: "06cfdbdb6d7d2ea023cc811d1e5b919d2686a02305f62a584e2f9a01c567fc60",
  bankConfirmation: "6839e5e6d403f3792adc14b101b85e314bc8fe8e6985acc1fedfa238c2caf6c1",
  prohibitedBusiness: "5aee60f343b8f7322009d9ca0ec9a5f5a26c1b28770277a9ea75b8a7c83a3e22",
} as const;

export const AGREEMENT_TEXT_FIELDS = {
  legalName: "text_1tlso",
  vTal: "text_2wdsp",
  postalAddress: "text_3icfn",
  postalCode: "text_4wysf",
  city: "text_5okjj",
  contactName: "text_6xbqk",
  contactPhone: "text_7vayx",
  contactEmail: "text_8isrj",
  invoiceEmail: "text_9okij",
  marketName: "text_10nusx",
  website: "text_11etra",
  productDescription: "text_12shak",
  annualCardTurnover: "text_14bgnq",
  averagePurchase: "text_15lqua",
  salesDenmarkPercent: "text_16hhgp",
  salesNordicsPercent: "text_17jgxj",
  salesEuPercent: "text_18mrcn",
  salesUsaPercent: "text_19jqyo",
  salesOtherPercent: "text_20bnbo",
  deliveryMethod: "text_21xayj",
  deliveryDays: "text_22sogi",
  savedCardInApp: "text_24qbza",
  otherWallet: "text_25xijh",
  recurringPayments: "text_26kdhq",
  otherMit: "text_27wvwn",
  websiteTerms: "text_28jdwr",
  madeToOrder: "text_30nilh",
  madeToOrderDelivery: "text_31sobz",
  madeToOrderShare: "text_29aggg",
  deposit: "text_32ffri",
  depositShare: "text_33bbbb",
  finalPaymentWhen: "text_34vyzz",
  finalPaymentMethod: "text_35gloh",
  dkkRegistrationNumber: "text_36damt",
  dkkAccountNumber: "text_37rtny",
  portalUserFirstName: "text_57ksra",
  portalUserLastName: "text_58poqq",
  portalUserEmail: "text_59xibh",
  establishmentFee: "text_61chji",
  monthlyFee: "text_62ltdf",
  minimumMonthlyPayment: "text_63ckcw",
  priceCategory: "text_120ppnt",
} as const;

export const AGREEMENT_CHECKBOX_FIELDS = {
  paymentLinkNone: "checkbox_137zffw",
  paymentLinkHtml: "checkbox_136jpfj",
  paymentLinkDigital: "checkbox_135wlap",
  paymentLinkPhysical: "checkbox_138iypg",
  walletMobilePay: "checkbox_134waos",
  walletApplePay: "checkbox_133jnfg",
  walletGooglePay: "checkbox_132riey",
  pspDandomain: "checkbox_131iwgd",
  pspEpay: "checkbox_130qbfv",
  pspSwedbank: "checkbox_128lajm",
  pspPensopay: "checkbox_129izqk",
  pspFrisbii: "checkbox_125gujh",
  pspQuickpay: "checkbox_126jmz",
  pspNets: "checkbox_127uz",
  hosted: "checkbox_124zlmq",
  handlesCardData: "checkbox_123cfov",
  threeDSecure: "checkbox_121yicn",
  cvvRequired: "checkbox_122bsei",
} as const;

export const BANK_CONFIRMATION_FIELDS = {
  legalName: "Virksomhedens juridiske navn",
  vTal: "CVRnr",
  registrationNumber: "Reg nr",
  accountNumber: "Kontonummer",
  // Deliberately not filled; the bank completes/signs the date field.
  bankDate: "Dato_2",
} as const;

export const PRICE_FIELD_COLUMNS = {
  visaTransaction: [
    "text_64gfpa", "text_65elqt", "text_66jwvw", "text_67oapu", "text_68rhxr",
    "text_69dhrh", "text_70vrny", "text_71lflp", "text_72vzxj",
  ],
  visaPercent: [
    "text_74sxu", "text_75msqa", "text_76kfji", "text_77rquh", "text_78iyja",
    "text_79pglr", "text_80emwf", "text_81mypa", "text_82rrgp",
  ],
  mastercardTransaction: [
    "text_83ttgk", "text_84fssr", "text_85wver", "text_86dszi", "text_87hfve",
    "text_88ydfs", "text_89cplv", "text_90kide", "text_91hukv",
  ],
  mastercardPercent: [
    "text_92ddng", "text_93smye", "text_94hjkq", "text_95raqu", "text_96jqxt",
    "text_97qnuh", "text_98huxr", "text_99jdbj", "text_100iulv",
  ],
  dinersTransaction: [
    "text_101uoro", "text_102vlau", "text_103cfll", "text_104zetk", "text_105cxzn",
    "text_106rfso", "text_107kewx", "text_108gnix", "text_109xirq",
  ],
  dinersPercent: [
    "text_110ymgv", "text_111iszp", "text_112zzzb", "text_113svdg", "text_114ub",
    "text_115uyei", "text_116klaz", "text_117rnvx", "text_118ggdx",
  ],
} as const;

export const PRICE_CATEGORIES = [
  "dk_debit",
  "dk_credit",
  "dk_corporate",
  "eu_debit",
  "eu_credit",
  "eu_corporate",
  "non_eu_debit",
  "non_eu_credit",
  "non_eu_corporate",
] as const;

export interface DocumentTemplate {
  id: string;
  kind: string;
  version: number;
  source_file_name: string;
  source_sha256: string;
  r2_key: string;
  field_map_json: string;
}

export async function getOfficialTemplate(
  db: Database,
  bucket: ObjectBucket | undefined,
  kind: "agreement" | "bank_confirmation",
): Promise<{ template: DocumentTemplate; bytes: Uint8Array }> {
  if (!bucket) throw new Error("Goymslan við almennu skjølunum er ikki sett upp");
  const template = await db
    .prepare(
      `SELECT id, kind, version, source_file_name, source_sha256, r2_key, field_map_json
       FROM document_template
       WHERE kind = ?1 AND country_code = 'FO' AND active = 1
       ORDER BY version DESC LIMIT 1`,
    )
    .bind(kind)
    .first<DocumentTemplate>();
  if (!template) throw new Error("Einki virkið Swedbank-skjal fyri Føroyar er skrásett");

  const object = await bucket.get(template.r2_key);
  if (!object) throw new Error("Swedbank FO-skjalið finst ikki í goymsluni");
  const value = new Uint8Array(await object.arrayBuffer());
  if (await sha256(value) !== template.source_sha256) {
    throw new Error("Swedbank-skjal og skrásetta hash-virðið samsvara ikki");
  }
  return { template, bytes: value };
}
