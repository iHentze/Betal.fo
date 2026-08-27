export const products = [
  {
    id: "alnetinum",
    href: "/alnetinum/",
    nav: "Á alnetinum",
    eyebrow: "Betal á alnetinum",
    title: "Gjaldsgátt til nethandil",
    card: "Gjaldsvindeyga, leinki og wallets — bygt á ePay.",
    lead: "Ein gjaldsuppliving ið hoyrir til tína sølu. Kort, Apple Pay og Google Pay í einum vindeyga tú kanst tillaga — ella sum leinki, tá tú ikki hevur nethandil.",
    audience: "Til nethandil, tænastur á netinum og fyritøkur ið senda faktura við gjaldsleinki.",
    points: [
      {
        title: "Gjaldsvindeyga ið passar tær",
        text: "Litir, knøttar og gjaldshættir eftir tínum vørumerki. Kundin kennir seg aftur, ikki sum um hann fór av síðuni.",
      },
      {
        title: "Á síðuni ella sum vindeyga",
        text: "Standard gjaldsvindeyga, tá tú skalt skjótt í gongd. Ella kortfelt beint á tínari síðu, tá tú vilt hava eina sømløysa keypsløtu.",
      },
      {
        title: "Gjaldsleinki til faktura",
        text: "Send eitt leinki í telduposti. Kundin rindar. Tú fert víðari. Ongin full nethandil tørvaður.",
      },
      {
        title: "Kort, Apple Pay og Google Pay",
        text: "Tað kundin longu brúkar. Wallets ovast, so tað tekur sekund — ikki eina longu kortformular.",
      },
    ],
    extra: {
      title: "Einki nethandil? Send eitt leinki.",
      body: "Faktura, tillaging ella ein staka sølu. Kundin fær eitt leinki, rindar, og tú sært tað í backoffice.",
      photo: "/brand/photo-card.jpg",
      photoAlt: "Betal-kort við skriftmerki og wallet-ikoni",
    },
  },
  {
    id: "stadnum",
    href: "/stadnum/",
    nav: "Á staðnum",
    eyebrow: "Betal á staðnum",
    title: "Telefonin er terminalurin",
    card: "Softpay. Einki eyka kassi á diskinum.",
    lead: "Softpay ger iPhone og Android til ein nándgjaldsterminal. Tú tekur ímóti korti, Apple Pay og Google Pay har tú stendur.",
    audience: "Til kaffistovu, lastbil, marknað, borðskipan og allar ið selja uttan fastan kassa.",
    points: [
      {
        title: "Eingin serligur terminalur",
        text: "Virkar á iPhone og Android við NFC. Tú brúkar telefonina, tú longu hevur.",
      },
      {
        title: "Nándgjald har tú ert",
        text: "Við borðið, í bilinum, á marknaðinum. Terminalurin flytur seg við tær.",
      },
      {
        title: "Standalone ella knýtt",
        text: "Brúka Softpay sum egna app, ella knýt hana at verandi kassaskipan.",
      },
      {
        title: "Skjótt at koma í gongd",
        text: "Vit fáa avtalu, app og útgjald á pláss. Tú byrjar at taka ímóti.",
      },
    ],
    extra: {
      title: "Appin á telefonini.",
      body: "Softpay situr har kundin longu rindar. Tú tekur ímóti uttan eyka kassa.",
      photo: "/brand/photo-app-icon.jpg",
      photoAlt: "Betal-appin á telefonini",
    },
  },
  {
    id: "hald",
    href: "/hald/",
    nav: "Hald",
    eyebrow: "Betal hald",
    title: "Vit røkja gjaldingarnar",
    card: "Tillagað loysn á ePay, hildin av okkum.",
    lead: "Tá standardgáttin ikki røkkur. Vit byggja og halda eina tillagaða loysn á ePay — so tú kanst selja, og vit taka tøknina.",
    audience: "Til fyritøkur við serligum flæði, egnu skipan, ella tørvi á at vit røkja gjaldingarnar.",
    points: [
      {
        title: "Bygt á ePay",
        text: "Gjaldsvindeyga, leinki, haldarar og backoffice. Kervið tú longu kennir — ella vit seta tað upp.",
      },
      {
        title: "Tillagað til tína skipan",
        text: "Integratión, reglur og flæði eftir tær — ikki ein pakki tú mást laga teg eftir.",
      },
      {
        title: "Vit halda tí",
        text: "Uppseting, backoffice, avstemming og hjálp tá nakað steðgar.",
      },
      {
        title: "Eitt navn, ein ábyrgd",
        text: "Kundin sær Betal. Tú sær eina loysn ið virkar. Restin er okkara.",
      },
    ],
    extra: {
      title: "Kundin sær Betal.",
      body: "Vit røkja ePay, backoffice og tað ið skal knýtast — so tú kanst selja.",
      photo: "/brand/photo-desk.jpg",
      photoAlt: "Betal á telefon og telduborði",
    },
  },
  {
    id: "lon",
    href: "/lon/",
    nav: "Løn",
    eyebrow: "Betal løn",
    title: "Løn til føroiska veruleikan",
    card: "Vit byggja hetta. Tú kanst longu siga frá.",
    comingSoon: true,
    lead: "Eitt lønarkervi ið skilur Føroyar. Ikki klárt enn. Tú kanst longu siga, hvat tú tørvar — so loysnin verður gjørd til tína gerandisdag.",
    audience: "Til fyritøkur ið vilja hava løn, skatt og útgjald á einum stað, uttan at flyta alt av landinum.",
    points: [
      {
        title: "Lagað til Føroyar",
        text: "Løn, skattur og innrætting eftir galdandi reglum her. Ikki ein útlendsk skipan við føroyskum plástri.",
      },
      {
        title: "Minni handanararbeiði",
        text: "Færri fílur, færri avrit, færri seinnapartar í Excel.",
      },
      {
        title: "Sama Betal",
        text: "Tá loysnin er klár, hoyrir hon til restina: gjald, hald og løn á einum stað.",
      },
      {
        title: "Kom við tínum tørvi",
        text: "Vit byggja hetta nú. Tíni ynski koma inn, áðrenn kervið er læst.",
      },
    ],
  },
] as const;

export type ProductId = (typeof products)[number]["id"];

export function productById(id: string) {
  return products.find((product) => product.id === id);
}

export const fo = {
  meta: {
    title: "betal — gjaldsloysnir til føroyska vinnu",
    description:
      "Gjaldsgátt, Softpay á staðnum, tillagaðar ePay-loysnir og løn. Betal hjálpir føroyskum fyritøkum at taka ímóti gjøldum.",
  },
  nav: {
    home: "Heim",
    products: "Tænastur",
    contact: "Samband",
    menu: "Valmynd",
    close: "Lat aftur",
  },
  home: {
    eyebrow: "Gjaldsloysnir",
    title: "Gjald. Har tú selur.",
    lead: "Á alnetinum, á staðnum, ella tillagað til tína skipan. Ein føroysk loysn — tú tosar við fólk her.",
    primary: "Sí tænastur",
    secondary: "Set teg í samband",
    productsEyebrow: "Tænastur",
    productsTitle: "Fýra loysnir. Sama Betal.",
    aboutEyebrow: "Hvørji vit eru",
    aboutTitle: "Føroyskt samskifti. Greið tøkni.",
    about:
      "Betal er ikki ein terminalhandil, og ikki eitt útlendskt kø. Vit eru ein føroysk gjaldsfyritøka: ePay á alnetinum, Softpay á staðnum, tillagað hald — og løn á veg.",
    contrast:
      "Hini selja kassar, merki og trý ymisk PSP-navn. Vit selja fýra loysnir við einum navni, og tøkni ið kundin sær.",
  },
  steps: {
    eyebrow: "Soleiðis",
    title: "Frá práti til fyrsta gjald.",
    items: [
      {
        title: "Tú sigur, hvat tú selur",
        text: "Nethandil, borð, lastbil ella nakað ið ikki passar í ein standard. Vit siga, hvør loysn tað er.",
      },
      {
        title: "Vit seta tøkni og avtalu",
        text: "Innloysing, ePay ella Softpay, og tað ið skal knýtast at tína skipan.",
      },
      {
        title: "Tú tekur ímóti",
        text: "Fyrsta goldna gjald. Síðani eru vit her, tá nakað steðgar.",
      },
    ],
  },
  methods: {
    label: "Kundin rindar við",
    items: ["Visa", "Mastercard", "Apple Pay", "Google Pay"],
  },
  faq: {
    eyebrow: "Spurningar",
    title: "Tað fólk vanliga spyrja.",
    items: [
      {
        q: "Tørvast V-tal?",
        a: "Ja. Tú skalt vera skrásettur hjá TAKS og hava V-tal, áðrenn vit kunnu seta gjaldsgátt ella Softpay í gongd.",
      },
      {
        q: "Eg havi longu eina loysn.",
        a: "Tað ger einki. Vit hjálpa tær at skifta — frá terminali, nethandilsgátt ella app — uttan at tú mást sjálvur ringja runt.",
      },
      {
        q: "Hvussu er hetta øðrvísi enn ein terminalveitari?",
        a: "Vit selja ikki ein kassa og eitt merki. Á alnetinum er tað ePay. Á staðnum er tað Softpay á telefonini. Hald er tá vit røkja tað. Løn kemur aftaná.",
      },
      {
        q: "Hvussu leingi tekur uppseting?",
        a: "Tá avtalur og upplýsingar eru inni, er vanlig gátt ella Softpay skjót at fáa í gongd. Tillagað hald tekur longri, tí tað verður bygt til tína skipan.",
      },
    ],
  },
  productCta: {
    title: "Skal vit seta hetta upp hjá tær?",
    button: "Skriva til okkum",
  },
  comingSoon: "Undir menning",
  audienceLabel: "Hesi nýta hetta",
  contact: {
    eyebrow: "Samband",
    title: "Skriva. Vit svara.",
    lead: "Sig hvat tú selur, og hvørja loysn tú hugsar um. Vit venda aftur á føroyskum.",
    name: "Navn",
    company: "Fyritøka",
    phone: "Telefon",
    email: "Teldupostur",
    product: "Tænasta",
    productAny: "Ikki víst enn",
    message: "Boð",
    submit: "Send",
    mailtoHint: "Teldupostur latast upp, so tú kanst senda.",
    required: "Útfyll navn, teldupost og boð.",
  },
  privacy: {
    eyebrow: "Privatlív",
    title: "Hvussu vit handfara upplýsingar",
    lead: "Tá tú skrivar til okkum, brúka vit bert tað tú sendir, til at svara tær.",
    body: [
      "Navn, teldupostur, telefon, fyritøka og boð verða send til okkara teldupost. Vit goyma tey so leingi samskiftið er viðkomandi, og ikki longur.",
      "Vit selja ikki upplýsingar, og vit brúka tær ikki til marknaðarføring uttan at tú hevur biðið um tað.",
      "Um tú vilt at vit strika tað tú hevur sent, skriva til somu adressu.",
    ],
  },
  notFound: {
    title: "Hendan síðan er ikki her.",
    lead: "Leinkjan er brotin, ella síðan er flutt.",
    home: "Aftur á forsíðuna",
  },
  footer: {
    tagline: "Gjaldsloysnir til føroyska vinnu.",
    products: "Tænastur",
    legal: "Annað",
    privacy: "Privatlív",
    contact: "Samband",
  },
};
