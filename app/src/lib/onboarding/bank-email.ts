export interface BankEmailDraftInput {
  to: string;
  cc: string;
  companyName: string;
  vTal: string;
  attachment: Uint8Array;
  createdAt?: Date;
  boundary?: string;
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

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function lines(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24) || "felag";
}

/**
 * RFC 822 draft with X-Unsent so supporting desktop mail clients open it as a draft.
 * The account number stays inside the attached bank form, never in subject/body.
 */
export function buildBankRequestEmail(input: BankEmailDraftInput): Uint8Array {
  const to = cleanEmailAddress(input.to, "bankan");
  const cc = cleanEmailAddress(input.cc, "CC");
  if (to.toLocaleLowerCase() === cc.toLocaleLowerCase()) {
    throw new Error("Telduposturin hjá bankanum og CC skulu vera ymiskir");
  }

  const boundary = input.boundary ?? `betal_${crypto.randomUUID().replaceAll("-", "")}`;
  const createdAt = input.createdAt ?? new Date();
  const subject = `Váttan av bankakontu – V-tal ${input.vTal}`;
  const body = [
    "Góðan dag,",
    "",
    `${input.companyName} (V-tal ${input.vTal}) søkir um kortinnloysing og hevur tørv á eini váttan av bankakontuni.`,
    "",
    "Vinarliga:",
    "1. Kanna upplýsingarnar í viðhefta skjalinum.",
    "2. Stempla og undirskriva skjalið.",
    "3. Svara øllum á hesum teldupostinum og legg stemplaða skjalið við.",
    "",
    "Viðskiftafólkið er sett í CC, so svarið kemur beinleiðis aftur til teirra.",
    "",
    "Takk fyri.",
  ].join("\r\n");

  const message = [
    `Date: ${createdAt.toUTCString()}`,
    `From: ${cc}`,
    `Reply-To: ${cc}`,
    `To: ${to}`,
    `Cc: ${cc}`,
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
    "X-Unsent: 1",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    lines(base64(new TextEncoder().encode(body))),
    "",
    `--${boundary}`,
    'Content-Type: application/pdf; name="bankastadfesting.pdf"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="bankastadfesting.pdf"',
    "",
    lines(base64(input.attachment)),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return new TextEncoder().encode(message);
}

export function bankEmailFileName(vTal: string): string {
  return `bankafyrispurningur-${safeFilePart(vTal)}.eml`;
}
