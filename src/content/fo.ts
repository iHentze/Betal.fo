export const products = [
  {
    id: "alnetinum",
    href: "/alnetinum/",
    nav: "Á alnetinum",
    eyebrow: "Betal á alnetinum",
    title: "Gjaldsvindeyga til nethandil",
    card: "Kort, Apple Pay og gjaldsleinki — á tínari síðu.",
    lead: "Kundin rindar á tínari síðu — við korti, Apple Pay ella Google Pay. Hevur tú ongan nethandil, sendir tú bert eitt gjaldsleinki.",
    audience: "Nethandlar, talgildar tænastur og øll, ið senda rokningar við gjaldsleinki.",
    tags: ["Gjaldsvindeyga", "Gjaldsleinki", "Apple Pay", "Google Pay"],
    points: [
      {
        title: "Vindeyga í tínum litum",
        text: "Búmerki, litir og snið eftir tær. Kundin verður verandi á tínari síðu, meðan hann rindar.",
      },
      {
        title: "Á síðuni ella sum vindeyga",
        text: "Standard gjaldsvindeyga, tá tú vilt skjótt í gongd. Ella innbygt kortfelt beint á heimasíðuni.",
      },
      {
        title: "Gjaldsleinki til rokningar",
        text: "Send eitt leinki í telduposti ella SMS. Kundin trýstir og rindar — uttan at tú tørvar ein nethandil.",
      },
      {
        title: "Kort, Apple Pay og Google Pay",
        text: "Tað, sum kundin longu brúkar, liggur ovast. Tað tekur fá sekund at rinda.",
      },
    ],
    extra: {
      eyebrow: "Gjaldsvindeygað",
      title: "Eingin nethandil? Send eitt leinki.",
      body: "Fakturar, serstøk tilboð ella stakar sølur. Kundin fær eitt trygt leinki, rindar við telefonini ella korti, og tú sært tað í backoffice.",
      tags: ["Eingin nethandil tørvast", "Fult yvirlit í backoffice", "3D Secure 2"],
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
    card: "Softpay á telefonini. Eingin eyka kassi, eingin leiga.",
    lead: "Softpay ger iPhone ella Android til ein fullgildan nándgjaldsterminal. Tak ímóti korti, Apple Pay og Google Pay — har tú stendur, uttan at leiga eitt tól.",
    audience: "Handlar, kaffistovur, handverkarar, tænastubilar, marknaðir og øll, ið selja uttan fastan kassa.",
    points: [
      {
        title: "Einki eyka tól á diskinum",
        text: "Virkar á iPhone og Android við NFC. Tú brúkar telefonina, ið tú longu hevur í lummanum.",
      },
      {
        title: "Nándgjald har tú ert",
        text: "Við borðið, á verkstaðnum, í bilinum ella á útimarknaðinum. Terminalurin fylgir tær.",
      },
      {
        title: "Sjálvstøðugt ella saman við kassanum",
        text: "Brúka Softpay sum app, ella bind hana saman við verandi kassa- og søluskipan.",
      },
      {
        title: "Vit seta tað í gongd",
        text: "Vit skipa avtalu, app og útgjald. Tú kanst taka ímóti gjaldi, so skjótt tað er klárt.",
      },
    ],
    extra: {
      title: "Appin á telefonini.",
      body: "Softpay virkar har kundin er. Tak ímóti nándgjaldi uttan at leiga terminal.",
      photo: "/brand/photo-app-icon.jpg",
      photoAlt: "Betal-appin á telefonini",
    },
  },
  {
    id: "hald",
    href: "/hald/",
    nav: "Hald",
    eyebrow: "Betal hald",
    title: "Tú selur — vit reka gjaldingarnar.",
    card: "Ein loysn, bygd um tína sølu. Vit reka hana.",
    lead: "Tá standardloysnin ikki røkkur. Vit byggja eina loysn um tína sølu og reka hana — so tú sleppur undan at ringja runt, tá okkurt steðgar.",
    audience: "Fyritøkur við haldaraskipan, serligum keypsgongdum ella tørvi á fullari umsiting av gjaldingum.",
    points: [
      {
        title: "Bygt um tína sølu",
        text: "Haldgjøld, leinki og yvirlit — sett saman eftir tí, hvussu tú selur.",
      },
      {
        title: "Tillagað til tína skipan",
        text: "Integratiónir, sjálvvirkandi mannagongdir og reglur eftir tínum tørvi — ikki ein pakki, ið tú mást laga teg eftir.",
      },
      {
        title: "Vit taka okkum av rakstrinum",
        text: "Uppseting, eftirlit, backoffice, avrokning og persónlig hjálp, um okkurt ivamál tekur seg upp.",
      },
      {
        title: "Eitt samband",
        text: "Kundin sær tín samleika. Tú fært eina loysn, ið virkar. Vit fylgja tær, um nakað broytist.",
      },
    ],
    extra: {
      eyebrow: "Backoffice",
      title: "Vit halda eyga við — tú sært úrslitið.",
      body: "Vit seta haldgjøld, reglur og integratiónir upp, so gjøldini verða drigin sjálvvirkandi eftir avtalu. Tú hevur altíð fult yvirlit yvir kundar og inngjaldingar.",
      photo: "/brand/photo-desk.jpg",
      photoAlt: "Betal á telefon og telduborði",
    },
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
      "Gjaldsvindeyga til nethandil, Softpay á telefonini og tillagað hald. Føroyskt svar, tá tú tørvar okkum.",
  },
  nav: {
    home: "Heim",
    products: "Loysnir",
    contact: "Samband",
    login: "Innrita",
    menu: "Valmynd",
    close: "Lat aftur",
  },
  home: {
    eyebrow: "Føroysk gjaldsloysn",
    title: "Gjaldsloysn til títt virksemi.",
    kicker: "Kom skjótt í gongd – Vit hjálpa tær",
    lead: "Við gjaldsloysn frá betal kanst tú taka ímóti flest gjaldskortum, so sum VISA, MasterCard, Apple Pay, Google Pay og meira. Loysnin lýkur øll nútímans trygdarkrøv og stuðlar 3D-Secure gjaldingar.",
    primary: "Sí loysnir",
    secondary: "Skriva til okkum",
    pills: ["Roynd og trygg tøkni", "Føroysk tænasta", "Eingin bindandi leiga"],
    productsEyebrow: "Loysnir",
    productsTitle: "Á netinum, í handlinum og tillagað.",
    aboutEyebrow: "Um Betal",
    aboutTitle: "Vit svara, tá tað brennur á.",
    about:
      "Vit eru føroyingar, ið byggja gjaldsloysnir til føroyska vinnu. Vit kenna, hvussu tað er at standa í handlinum ein trongan fríggjadag, tá gjaldið ikki fer ígjøgnum. Tí svara vit, tá tú ringir — og tí sleppa vit ikki, fyrr enn tað virkar.",
    contrast:
      "Eitt samband til innloysing, gjaldsloysn og Softpay. Veksur virksemið, víðka vit. Minkar tað, minka vit.",
    explore: "Les meira",
    onlineTitle: "Eitt gjaldsvindeyga, ið er bygt til at selja.",
    onlineLead:
      "Apple Pay og Google Pay ovast. Sjálvvirkandi kortkanning. 3D Secure, ið bert steðgar, tá tað veruliga er neyðugt. Alt í tínum litum, á tínum navni.",
    onlinePoints: [
      {
        title: "Apple Pay og Google Pay ovast",
        text: "Kundin er liðugur upp á fá sekund, uttan at skriva eitt einasta tal.",
      },
      {
        title: "Sniðgivið eftir tínum vørumerki",
        text: "Litir, búmerki og snið. Kundin fer ongantíð av tínari síðu.",
      },
      {
        title: "Gjaldsleinki uttan nethandil",
        text: "Send eina rokning við telduposti ella SMS og fá inn gjaldið samstundis.",
      },
    ],
    moreAbout: "Les meira um",
    specs: [
      { label: "Frá undirskrift til fyrsta gjald", value: "1–2 vikur" },
      { label: "Útgjald", value: "Hvønn dag" },
    ],
    ribbonLabel: "Gjaldsloysnir til føroyska vinnu",
    ribbonTitle: "Eitt samband — alt gjaldið.",
    ribbonText: "Á alnetinum, á staðnum og tá tú vilt, at vit røkja tað.",
    backofficeEyebrow: "Backoffice",
    backofficeTitle: "Øll gjøldini í einum yvirliti.",
    backofficeLead:
      "Fylg hvørjum gjaldi — frá góðkenning og 3D Secure til avrokning. Tak gjald, endurgjald ella strika beint úr yvirlitinum.",
    backofficeTags: ["Beinleiðis yvirlit", "Endurgjald við einum klikki", "Avrokning", "API og webhooks"],
    backofficeCta: "Sí hvussu vit røkja tað fyri teg",
    softpayLead:
      "Softpay ger iPhone ella Android til ein fullgildan nándgjaldsterminal. Eingin leiga, eingin eyka kassi — bert telefonin, tú longu hevur.",
    softpayCta: "Les meira um Softpay",
    closingTitle: "Ert tú til reiðar at selja?",
    closingLead:
      "Sig okkum, hvar tú selur. Vit koma aftur við eini loysn, ið passar — og fylgja tær, til tað virkar.",
    closingSecondary: "Sí allar loysnir",
  },
  clients: {
    label: "Tey brúka Betal",
  },
  steps: {
    eyebrow: "Gongdin",
    title: "Frá fyrsta práti til goldið gjald.",
    items: [
      {
        title: "Tú sigur, hvar tú selur",
        text: "Nethandil, handil, bilur, marknaður ella serlig skipan. Vit finna røttu loysnina saman.",
      },
      {
        title: "Vit seta avtalu og tøkni upp",
        text: "Innloysing, uppseting, Softpay og samantvinnan við tína skipan. Tú sleppur undan at ringja runt.",
      },
      {
        title: "Tú tekur ímóti gjaldi",
        text: "Kendir gjaldshættir og føroysk hjálp, um okkurt ivamál tekur seg upp. Vit standa við.",
      },
    ],
  },
  methods: {
    label: "Kundin rindar við",
  },
  values: {
    eyebrow: "Hví Betal",
    items: [
      {
        icon: "window",
        title: "Gjaldsvindeyga í tínum litum",
        text: "Tryggja eina góða uppliving. Kundin fer ongantíð av tínari síðu, og vindeygað verður sniðgivið nágreiniliga eftir tínum vørumerki.",
      },
      {
        icon: "link",
        title: "Gjaldsleinki uttan nethandil",
        text: "Slepp undan bíðitíð og fakturum. Send eitt leinki við SMS ella telduposti, og fá peningin inn samstundis.",
      },
      {
        icon: "wallet",
        title: "Apple Pay og Google Pay",
        text: "Kundin hevur avgreitt keypið innan fá sekund uttan at skriva eitt einasta tal inn.",
      },
      {
        icon: "phone",
        title: "Telefonin sum terminalur",
        text: "Softpay ger tína iPhone ella Android til ein nándgjaldsterminal. Eingin dýrur terminalur, smidligt og einfalt.",
      },
      {
        icon: "backoffice",
        title: "Fult yvirlit í backoffice",
        text: "Fylg hvørjum gjaldi frá byrjan til enda. Ger endurgjøld við einum klikki og fá eina greiða avrokning til bókhaldið.",
      },
      {
        icon: "support",
        title: "Føroysk hjálp",
        text: "Ongar langar bíðiraðir hjá útlendskum veitarum. Tú fært fatur á einum føroyingi, sum altíð er til reiðar at hjálpa.",
      },
    ],
  },
  faq: {
    eyebrow: "Spurningar og svør",
    title: "Tað, sum fólk oftast spyrja um.",
    items: [
      {
        q: "Tørvast mær V-tal fyri at koma í gongd?",
        a: "Ja. Fyritøkan skal vera skrásett hjá TAKS við V-tali, áðrenn vit kunnu stovna innloysingaravtalu og seta gjaldsloysn ella Softpay upp.",
      },
      {
        q: "Eg havi longu eina aðra gjaldsloysn — er tað trupult at skifta?",
        a: "Nei. Vit taka flytingina — frá gomlum terminali, nethandilsloysn ella app — so tú sleppur undan at ringja runt.",
      },
      {
        q: "Hvat fái eg hjá Betal?",
        a: "Á alnetinum eina sniðgivna gjaldsloysn. Á staðnum tína egnu telefon við Softpay. Skal tað tillagast, røkja vit tøknina. Og tú fært eitt nummar, har tú fært svar á føroyskum.",
      },
      {
        q: "Hvussu leingi tekur tað at koma í gongd?",
        a: "Tá upplýsingar eru á plássi og avtalurnar undirskrivaðar, kann ein vanlig gjaldsloysn ella Softpay vera klár upp á fáar dagar. Tillagað hald tekur longri, alt eftir samantvinnanini við tína skipan.",
      },
    ],
  },
  productCta: {
    title: "Skulu vit seta hetta upp hjá tær?",
    lead: "Fá eitt óbindandi prát um tína gjaldsloysn. Vit svara á føroyskum og hjálpa tær í gongd.",
    button: "Skriva til okkum",
    other: "Aðrar loysnir",
  },
  comingSoon: "Undir menning",
  audienceLabel: "Hóskar til",
  contact: {
    eyebrow: "Samband",
    title: "Sig frá tínum tørvi — vit seta tað upp.",
    lead: "Greið frá, hvar tú selur, og hvat tú tørvar. Vit venda aftur á føroyskum og fylgja tær, til tað virkar.",
    direct: "Skriva beinleiðis",
    name: "Navn",
    company: "Fyritøka",
    phone: "Telefonnummar",
    email: "Teldupostur",
    product: "Ynskt tænasta",
    productAny: "Vel tænastu (valfrítt)",
    message: "Boð",
    namePlaceholder: "Títt navn",
    companyPlaceholder: "Tín fyritøka",
    phonePlaceholder: "+298 ...",
    emailPlaceholder: "navn@fyritoka.fo",
    messagePlaceholder: "Greið stutt frá, hvar tú selur, og hvat tú tørvar.",
    submit: "Send boð",
    sending: "Sendi…",
    sent: "Takk. Vit hava fingið boðini og venda aftur á føroyskum.",
    sendFailed: "Okkurt gekk skeivt. Royn aftur, ella skriva beinleiðis til okkum á hesari adressu.",
    mailtoHint: "Títt teldupostforrit letur upp, so tú kanst senda boðini.",
    required: "Vinarliga skriva navn, teldupost og boð.",
    invalidEmail: "Vinarliga skriva eina gildiga teldupostadressu.",
  },
  privacy: {
    eyebrow: "Privatlívspolitikkur",
    title: "Hvussu vit handfara tínar upplýsingar",
    lead: "Vit taka vernd av tínum persónsupplýsingum í fullum álvara. Tá tú hevur samband við okkum, brúka vit bert tínar upplýsingar til at svara tær og veita tænastu.",
    body: [
      "Upplýsingar sum navn, teldupostur, telefonnummar, fyritøka og innihald í boðum verða sendar beinleiðis til okkara teldupost. Vit goyma bert hesar upplýsingar so leingi, sum tað er neyðugt fyri at avgreiða tín fyrispurning.",
      "Vit selja ella lata ongantíð tínar upplýsingar víðari til triðjapartsfeløg, og vit brúka tær ikki til óbidna marknaðarføring.",
      "Tú hevur altíð rætt til at fáa innlit í ella biðja um striking av teimum upplýsingum, ið vit hava um teg. Set teg í samband við okkum á {email}.",
    ],
  },
  notFound: {
    title: "Síðan varð ikki funnin.",
    lead: "Leinkjan er møguliga gomul, ella síðan er flutt.",
    home: "Aftur á forsíðuna",
  },
  footer: {
    tagline: "Ein føroysk gjaldsloysn til tína fyritøku.",
    products: "Loysnir",
    legal: "Kunning",
    privacy: "Privatlív",
    contact: "Samband",
    builtOn: "Bygt á royndari tøkni",
  },
};
