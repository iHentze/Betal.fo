/**
 * Webhook authentication.
 *
 * ePay applies no signature and no payload signing. Quoting the docs: "Verification
 * relies exclusively on the `Authorization` header." There is no HMAC to fall back on,
 * no timestamp and no replay protection, so the entire security of the ingest path is:
 *
 *   1. the secret is unique per merchant (ePay explicitly warns partners not to share
 *      one secret across merchants),
 *   2. the comparison is constant time, and
 *   3. the endpoint is TLS-only.
 *
 * The header value is the complete secret including the scheme, and the scheme is not
 * guaranteed to be Bearer, so the whole string is compared verbatim.
 */

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(digest);
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison is always over 32 fixed-length bytes.
 * That removes the length-based early exit an ordinary string compare would have, and
 * means a wrong secret of a different length costs the same as a wrong secret of the
 * same length.
 */
export async function secretsMatch(
  presented: string | null,
  expected: string | null,
): Promise<boolean> {
  if (!presented || !expected) return false;

  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= (a[i] as number) ^ (b[i] as number);
  }
  return difference === 0;
}

/**
 * Stable fingerprint of a delivery, used to collapse ePay's retries.
 *
 * ePay retries a failed delivery up to 25 times with the identical body, and our
 * handler must be idempotent. Hashing the merchant plus the raw body gives a key we
 * can enforce with a unique index.
 */
export async function deliveryFingerprint(
  merchantId: string | null,
  rawBody: string,
): Promise<string> {
  const digest = await sha256(`${merchantId ?? "unknown"}:${rawBody}`);
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Generates a webhook secret for a new point of sale. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  // ePay stores and replays the full header value, scheme included.
  return `Bearer ${token}`;
}
