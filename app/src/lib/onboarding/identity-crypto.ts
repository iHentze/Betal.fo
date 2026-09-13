function decodeKey(value: string): Uint8Array {
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32) throw new Error("wrong length");
    return bytes;
  } catch {
    throw new Error("IDENTITY_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function encryptPersonalIdentificationNumber(
  value: string,
  base64Key: string,
): Promise<{ ciphertext: string; last4: string }> {
  const clean = value.replace(/\s/g, "");
  if (!clean) throw new Error("Empty personal identification number");
  const keyBytes = decodeKey(base64Key);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(clean),
    ),
  );
  const payload = new Uint8Array(iv.byteLength + encrypted.byteLength);
  payload.set(iv);
  payload.set(encrypted, iv.byteLength);
  return {
    ciphertext: encode(payload),
    last4: clean.slice(-4),
  };
}

export async function decryptPersonalIdentificationNumber(
  ciphertext: string,
  base64Key: string,
): Promise<string> {
  const payload = Uint8Array.from(atob(ciphertext), (character) => character.charCodeAt(0));
  if (payload.byteLength < 29) throw new Error("Invalid encrypted identity");
  const key = await crypto.subtle.importKey(
    "raw",
    decodeKey(base64Key),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: payload.slice(0, 12) },
    key,
    payload.slice(12),
  );
  return new TextDecoder().decode(decrypted);
}
