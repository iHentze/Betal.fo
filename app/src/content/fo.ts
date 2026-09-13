/**
 * Faroese copy for the application.
 *
 * Faroese is the default and only language here. ePay's checkout supports `fo` as a
 * first-class locale, so a merchant's customer can pay in Faroese and the merchant can
 * run their business in Faroese, which is the whole point of the product.
 *
 * Terminology follows the marketing site in src/content/fo.ts at the repository root:
 * gjald, gjaldsleinki, avstemming, útgjald.
 */

export const fo = {
  brand: "betal",

  nav: {
    overview: "Yvirlit",
    transactions: "Gjaldingar",
    settlements: "Avrokningar",
    invoices: "Rokningar",
    links: "Gjaldsleinki",
    subscriptions: "Áskriftir",
    terminals: "Terminalar",
    settings: "Stillingar",
    // Betal staff only.
    merchants: "Handlar",
    periods: "Tíðarskeið",
    margin: "Vinningur",
    leads: "Áhugaðir",
    support: "Stuðul",
    applications: "Umsóknir",
    design: "Snið",
    backToApp: "Aftur til skipanina",
  },

  common: {
    search: "Leita",
    filter: "Filtur",
    clear: "Rudda",
    cancel: "Avlýs",
    save: "Goym",
    close: "Lat aftur",
    loading: "Innlesur",
    none: "Einki",
    all: "Alt",
    of: "av",
    showing: "Vísir",
    noResults: "Einki funnið",
    amount: "Upphædd",
    date: "Dagfesting",
    status: "Støða",
    reference: "Tilvísing",
    customer: "Kundi",
    total: "Tilsamans",
    actions: "Gerðir",
    copy: "Avrita",
    copied: "Avritað",
  },

  transactions: {
    title: "Gjaldingar",
    empty: "Ongar gjaldingar enn.",
    emptyFiltered: "Ongar gjaldingar samsvara við filtrið.",
    count: (n: number) => (n === 1 ? "1 gjalding" : `${n} gjaldingar`),
    hidden: (n: number) => `${n} fjaldar av filtri`,
    card: "Kort",
    acquirer: "Innloysari",
    method: "Gjaldshátt",
    captured: "Tikið",
    refunded: "Endurgoldið",
    remaining: "Eftir",
    authorized: "Góðkent",
    surcharge: "Tillegg",
    refund: "Endurgjald",
    capture: "Tak gjald",
    void: "Ógilda",
    refundConfirm: "Endurgjalda hesa gjalding?",
    // The masked PAN and 3DS outcome only ever arrive on the webhook.
    sca: "Trygdarváttan",
    scheme: "Kortslag",
    issuer: "Banki",
  },

  settlements: {
    title: "Avrokningar",
    empty: "Ongar avrokningar enn.",
    transfer: "Yvirfluttur",
    posted: "Bókað",
    netAmount: "Netto",
    fees: "Avgjøld",
    transactionCount: "Gjaldingar",
    // The screen that explains the gap between what they sold and what arrived.
    breakdown: "Hvat varð tikið frá",
    acquirerFee: "Innloysaragjald",
    interchangeFee: "Interchange",
    schemeFee: "Kortnetsgjald",
    reserve: "Trygd",
    adjustment: "Rætting",
    fee: "Gjald",
    explainer:
      "Hetta er munurin millum tað tú seldi og tað ið kom inn á kontuna. Avgjøldini eru tikin av innloysaranum, ikki av Betal.",
  },

  invoices: {
    title: "Rokningar",
    number: "Rokningarnr.",
    issued: "Sent",
    due: "Gjaldsdagur",
    net: "Uttan MVG",
    vat: "MVG",
    gross: "Tilsamans",
    period: "Tíðarskeið",
    lines: "Postar",
    creditNote: "Kredittnota",
    download: "Tak niður",
    vTal: "V-tal",
    payNow: "Rinda nú",
  },

  periods: {
    title: "Tíðarskeið",
    freeze: "Frys",
    reconcile: "Avstem",
    rate: "Rokna",
    issue: "Send rokningar",
    // Reconciliation gates invoicing; this is the message when it has not run.
    blocked:
      "Tíðarskeiðið er ikki avstemt. Rokningar kunnu ikki sendast, fyrr enn tølini eru vátta.",
    discrepancyFound: (n: number) =>
      `${n} ósamsvar millum okkara talvu og ePay. Tey mugu loysast, áðrenn roknað verður.`,
    inMirror: "Í okkara talvu",
    inEpay: "Hjá ePay",
    missing: "Vantar",
    extra: "Ov nógv",
  },

  webhooks: {
    paused: "Hendingar eru steðgaðar",
    pausedExplainer:
      "ePay hevur steðgað hendingum til henda handilin, tí ov nógv boð miseydnaðust. Dátur verða ikki dagførdar, fyrr enn hetta er rættað.",
    healthy: "Hendingar virka",
  },

  merchants: {
    title: "Handlar",
    vTal: "V-tal",
    epayAccount: "ePay-konta",
    pointsOfSale: "Sølustøð",
    plan: "Prísskipan",
    onboarding: "Verður sett upp",
    active: "Virkin",
    suspended: "Steðgað",
    closed: "Latin aftur",
  },

  margin: {
    title: "Vinningur",
    revenue: "Inntøka",
    cost: "Kostnaður",
    margin: "Vinningur",
    perTransaction: "Per gjalding",
    // ePay exposes no billing data, so the cost side is configured by hand.
    costNote:
      "Kostnaðurin hjá ePay er skrásettur av okkum — ePay letur ikki hesi tølini út gjøgnum API.",
    acquirerComparison: "Samanbering av innloysarum",
    effectiveRate: "Veruligur prísur",
  },

  errors: {
    notFound: "Ikki funnið",
    forbidden: "Tú hevur ikki atgongd til hetta",
    generic: "Okkurt gekk galið. Royn aftur.",
    // Surfaced when a money operation returned HTTP 200 but failed.
    operationFailed: "Gerðin miseydnaðist",
  },

  onboarding: {
    title: "Umsókn",
    saved: "Goymt",
    back: "Aftur",
    continue: "Halt áfram",
    resume: "Halt áfram við umsóknini",
    bannerTitle: "Gjaldingar eru ikki tøkar enn",
    bannerDetail:
      "Innloysarin hevur ikki góðkent pakkan. Tú kanst sitja í skipanini — vit siga tær, tá ið tú kanst taka ímóti korti.",
    checklistTitle: "Hvat vantar",
    steps: {
      felag: "Felagið",
      vinnugrein: "Virkið",
      eigarar: "Eigarar og undirskrivarar",
      roknskapur: "Búskapur",
      banki: "Bankakonta",
      skjol: "Skjøl",
      undirskriva: "Undirskriva",
      bida: "Bíða",
    },
    why: {
      felag: "Finn felagið á eyga.fo og vátta almennu upplýsingarnar. Tað, sum ikki er alment, spyrja vit um.",
      vinnugrein: "Greið stutt frá, hvat tit gera og selja. Tað avger, hvør innloysari hóskar.",
      eigarar: "Vátta eigararnar frá Eyga og fyll bert privatu upplýsingarnar, sum ikki eru í almennu skránni.",
      roknskapur: "Tvey stutt svar hjálpa okkum at velja røttu leiðina fyrstu ferð.",
      banki: "Fyrst kontunummarið, so eitt forútfylt skjal til bankan at stempla.",
      skjol: "Legg bert skjølini upp, sum innloysarin veruliga krevur.",
      undirskriva: "Les forútfyltu FO-avtaluna og vel Samleikan ella undirskrift á pappíri.",
      bida: "Pakkin er hjá okkum. Her sært tú, hvat hendir næst.",
    },
    eygaSearch: "Leita eftir navni ella skrásetingarnummari",
    eygaSource: "Almennar upplýsingar frá eyga.fo",
    eygaPrivate:
      "Eyga vísir ikki P-tal ella privatar adressur. P-talið verður váttað trygt við Samleikanum — tú skalt ikki skriva tað her.",
    sector1:
      "Hendan greinin fer ikki til Swedbank. Vit mæla til Clearhaus, og starvsfólk taka støðu.",
    sector2: "Hendan greinin kann fara til Swedbank, men krevur hægri prís og eyka skjøl.",
    noSwedbankPdf: "Vit gera ikki eina Swedbank-avtalu, tá ið tilmælið er ein annar innloysari.",
    skrivaBlocked:
      "Skriva er stongt, til FO-avtalan er fylt og príslistin settur. Staging bíðar eisini eftir Klintra-brúkara.",
    priceListMissing: "Príslistin er ikki settur. Vit senda ikki eina avtalu uttan FO-prísir.",
    wetInk: "Undirskriva á pappír og send mynd av undirskrift og persónsprovi.",
    waitSwedbank: "Swedbank hevur pakkan. Vit siga tær, tá ið teir hava tikið støðu.",
    waitClearhaus: "Vit rætta hetta móti Clearhaus. Tú skalt ikki senda nakað til Swedbank.",
    waitStaff: "Starvsfólk hjá Betal lesa pakkan. Vit skriva, um okkurt vantar.",
    events: {
      created: "Umsókn stovnað",
      screened: "Skoðan",
      document_uploaded: "Skjal lagt upp",
      acknowledged_reroute: "Clearhaus-leið váttað",
      wet_ink: "Undirskrivað á pappír",
      submitted: "Sent til innloysara",
      rerouted: "Flutt innloysara",
      rejected: "Avvíst",
      docs_requested: "Fleiri skjøl biðið um",
      staff_sector: "Geiri sett við hond",
      skriva_blocked_no_tenant: "Skriva ikki tøkt",
      skriva_sent: "Undirskrift stovnað í Klintra",
      skriva_signed: "Avtala undirskrivað við Samleikanum",
      bank_request_sent: "Bankafyrispurningur sendur",
    },
  },
} as const;

export type FoContent = typeof fo;
