import type { CreateEmailOptions } from "resend";

export interface BankEmailInput {
  from: string;
  to: string;
  cc: string;
  companyName: string;
  vTal: string;
  applicationId: string;
  attachment: Uint8Array;
}

const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function cleanEmailAddress(value: string, label: string): string {
  const clean = value.trim();
  if (
    !clean ||
    clean.length > 254 ||
    /[\r\n,;]/.test(clean) ||
    !EMAIL.test(clean)
  ) {
    throw new Error(`Skriva ein gildugan teldupost til ${label}`);
  }
  return clean;
}

function cleanSender(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 320 || /[\r\n]/.test(clean)) {
    throw new Error("Sendari til bankateldupost er ikki rætt settur");
  }
  return clean;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function bankRequestText(companyName: string, vTal: string): string {
  return [
    "Góðan dag,",
    "",
    `${companyName} (V-tal ${vTal}) søkir um kortinnloysing og hevur tørv á eini váttan av bankakontuni.`,
    "",
    "Vinarliga:",
    "1. Kanna upplýsingarnar í viðhefta skjalinum.",
    "2. Stempla og undirskriva skjalið.",
    "3. Svara øllum á hesum teldupostinum og legg stemplaða skjalið við.",
    "",
    "Viðskiftafólkið er sett í CC og sum svarmóttakari, so svarið kemur beinleiðis aftur til teirra.",
    "",
    "Takk fyri.",
    "",
    "Vinarliga",
    "Betal",
  ].join("\n");
}

export function buildBankRequestEmail(input: BankEmailInput): CreateEmailOptions {
  const to = cleanEmailAddress(input.to, "bankan");
  const cc = cleanEmailAddress(input.cc, "CC");
  if (to.toLocaleLowerCase() === cc.toLocaleLowerCase()) {
    throw new Error("Telduposturin hjá bankanum og CC skulu vera ymiskir");
  }

  return {
    from: cleanSender(input.from),
    to,
    cc,
    replyTo: cc,
    subject: `Váttan av bankakontu – V-tal ${input.vTal}`,
    text: bankRequestText(input.companyName, input.vTal),
    attachments: [{
      filename: "bankastadfesting.pdf",
      content: base64(input.attachment),
      contentType: "application/pdf",
    }],
    tags: [
      { name: "email_type", value: "bank_request" },
      { name: "application_id", value: input.applicationId },
    ],
  };
}

/** Same payload gets the same key for 24 hours; changed recipients/PDF get a new key. */
export async function bankRequestIdempotencyKey(input: BankEmailInput): Promise<string> {
  const metadata = new TextEncoder().encode(
    `${input.applicationId}\0${input.to.trim().toLowerCase()}\0${input.cc.trim().toLowerCase()}\0`,
  );
  const bytes = new Uint8Array(metadata.byteLength + input.attachment.byteLength);
  bytes.set(metadata);
  bytes.set(input.attachment, metadata.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `bank-request/${input.applicationId}/${hex}`;
}
