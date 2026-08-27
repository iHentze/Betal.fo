export const products = [
  {
    id: "alnetinum",
    href: "/alnetinum/",
    nav: "Á alnetinum",
    eyebrow: "Betal á alnetinum",
    title: "Gjaldsgátt til nethandil",
    card: "Kort, Apple Pay og Google Pay har kundin longu keypir.",
    lead: "Ein gjaldsgátt til nethandil, tænastur og gjaldsleinki. Vit seta upp, so gjaldingin hoyrir til tína sølu — ikki øvugt.",
    audience: "Til nethandil, tænastur á netinum og fyritøkur ið senda faktura við gjaldsleinki.",
    points: [
      {
        title: "Gjaldsvindeyga ella integratión",
        text: "Standard gjaldsvindeyga, tá tú skalt skjótt í gongd, ella knýtt beint at tína nethandil.",
      },
      {
        title: "Gjaldsleinki",
        text: "Send eitt leinki, tá tú ikki hevur eina fulla nethandil. Kundin rindar. Tú fert víðari.",
      },
      {
        title: "Kort og wallets",
        text: "Vanlig kort, Apple Pay og Google Pay. Tað kundin longu brúkar.",
      },
      {
        title: "Uppseting og innloysing",
        text: "Vit hjálpa tær ígjøgnum avtalur og tøkni, so tú sleppur undan at ringja runt.",
      },
    ],
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
        text: "Kervið tú longu kennir, ella vit seta tað upp. Onki nýtt hjól, har tað ikki tørvast.",
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
      "Betal er ein føroysk gjaldsfyritøka. Vit seta upp gjaldsgátt, Softpay og tillagaðar loysnir — og byggja løn. Tú sleppur undan útlendskum køum og óljósum pakkum.",
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
