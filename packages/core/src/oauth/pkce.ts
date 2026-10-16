const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(byteLength))));
}

export async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));
}

export async function sha256Hex(input: string): Promise<string> {
  return [...(await sha256(input))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Code de vérification PKCE : 43 caractères base64url (RFC 7636). */
export const newCodeVerifier = () => randomToken(32);

/** Défi PKCE « S256 » : base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(verifier));
}
