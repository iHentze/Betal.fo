import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ApplicationPack, PriceList } from "./application";
import { parsePriceRates, priceListHasRates } from "./application";
import { canGenerateSwedbankAgreement } from "./steps";

/**
 * Generated stand-in for Kortindlosning-Online-FO.pdf until the official AcroForm
 * is in the repo and mapped. Skriva signs whatever bytes we send, so this document
 * is explicit about country FO and which price list it carries.
 *
 * Helvetica is WinAnsi, which includes Faroese æ ø á í ó ú ý ð.
 */

const navy = rgb(0.05, 0, 0.2);
const ink = rgb(0.12, 0.1, 0.18);
const muted = rgb(0.35, 0.34, 0.4);

function text(value: string | null | undefined): string {
  return (value ?? "").trim() || "—";
}

export function canFillAgreement(pack: ApplicationPack): { ok: true } | { ok: false; reason: string } {
  if (!canGenerateSwedbankAgreement(pack)) {
    return { ok: false, reason: "Vit gera ikki eina Swedbank-avtalu, tá ið tilmælið ikki er Swedbank." };
  }
  const app = pack.application;
  if (app.country_code !== "FO") {
    return { ok: false, reason: "Landakoda má vera FO." };
  }
  if (!app.legal_name || !app.v_tal || !app.address_line_one) {
    return { ok: false, reason: "Felagsnavn, V-tal og adressa mugu vera sett." };
  }
  if (!pack.owners.some((owner) => owner.is_signatory)) {
    return { ok: false, reason: "Í minsta lagi ein undirskrivari." };
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
  if (!priceListHasRates(priceList)) {
    return {
      ok: false,
      reason: "Príslistin er ikki settur. Vit senda ikki eina avtalu uttan FO-prísir.",
    };
  }
  if (!skrivaReady) {
    return {
      ok: false,
      reason: "Skriva-brúkari er ikki settur. Staging bíðar eftir Klintra-tenanti.",
    };
  }
  return { ok: true };
}

export async function fillAgreementPdf(
  pack: ApplicationPack,
  priceList: PriceList | null,
): Promise<Uint8Array> {
  const check = canFillAgreement(pack);
  if (!check.ok) throw new Error(check.reason);

  const app = pack.application;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 800;

  const line = (value: string, size = 10, face = font, color = ink) => {
    page.drawText(value, { x: 48, y, size, font: face, color });
    y -= size + 6;
  };

  page.drawRectangle({ x: 0, y: 810, width: 595.28, height: 32, color: navy });
  page.drawText("Swedbank Pay  ·  Kortinnloysing online  ·  FO", {
    x: 48,
    y: 820,
    size: 11,
    font: bold,
    color: rgb(0.48, 0.85, 0.4),
  });

  y = 780;
  line("Acquiring agreement — Faroe Islands", 14, bold, navy);
  line("Country code on this agreement: FO", 11, bold);
  y -= 8;
  line("Felag", 11, bold);
  line(`Navn: ${text(app.legal_name)}`);
  line(`Felagsslag: ${text(app.company_type)}`);
  line(`V-tal: ${text(app.v_tal)}`);
  line(`Adressa: ${text(app.address_line_one)}${app.address_line_two ? `, ${app.address_line_two}` : ""}`);
  line(`${text(app.postal_code)} ${text(app.city)}`);
  line(`Heimasíða: ${text(app.website)}`);
  line(`Hvat tey selja: ${text(app.sells)}`);
  line(`Vinnugrein: ${text(app.vertical_key)}  ·  geiri ${app.vertical_sector ?? "—"}`);
  y -= 8;
  line("Undirskrivarar / eigarar", 11, bold);
  for (const owner of pack.owners) {
    const pct = owner.ownership_bps == null ? "—" : `${(owner.ownership_bps / 100).toFixed(1)}%`;
    line(
      `${owner.name}  ·  ${pct}  ·  ${
        owner.is_signatory ? "undirskrivari" : "eigari"
      }`,
    );
  }
  y -= 8;
  line("Príslisti", 11, bold);
  const rates = parsePriceRates(priceList);
  if (rates.length === 0) {
    line("Príslisti ikki settur — hendan avtalan má ikki sendast til Skriva.", 10, bold, rgb(0.65, 0.15, 0.1));
  } else {
    line(`${priceList?.kind ?? "standard"}  ·  version ${priceList?.version ?? "—"}  ·  ${priceList?.country_code ?? "FO"}`);
    for (const rate of rates) {
      const bps = rate.rate_bps == null ? rate.text ?? "" : `${(rate.rate_bps / 100).toFixed(2)}%`;
      line(`${rate.label}: ${bps}`);
    }
  }
  y -= 12;
  line("Undirskrift og P-tal hjá undirskrivara koma frá Samleikanum / Skriva.", 9, font, muted);
  line(`Útflutt ${new Date().toISOString().slice(0, 10)}  ·  Betal`, 9, font, muted);

  return pdf.save();
}

export async function fillBankFormPdf(pack: ApplicationPack): Promise<Uint8Array> {
  const app = pack.application;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 780;

  const line = (value: string, size = 11, face = font) => {
    page.drawText(value, { x: 48, y, size, font: face, color: ink });
    y -= size + 8;
  };

  page.drawText("Swedbank Pay — Bekraeftelse af konto", { x: 48, y: 800, size: 14, font: bold, color: navy });
  line("Bankin fyllir og stemplar restina. Betal fyllir bert tað handilin veit.");
  y -= 8;
  line(`Handil: ${text(app.legal_name)}`, 12, bold);
  line(`V-tal: ${text(app.v_tal)}`);
  line(`Kontunr.: ${text(app.bank_account)}`);
  line(`Land: FO`);
  y -= 16;
  line("Stemplað av bankanum:", 11, bold);
  page.drawRectangle({
    x: 48,
    y: y - 120,
    width: 500,
    height: 130,
    borderColor: rgb(0.6, 0.6, 0.65),
    borderWidth: 1,
  });

  return pdf.save();
}
