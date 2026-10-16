// Vérification de la signature des webhooks Meta (en-tête `X-Hub-Signature-256: sha256=<hex>`).
// Doit être calculée sur le corps brut, tel que reçu, avant tout JSON.parse.

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function computeMetaSignature(rawBody: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  return `sha256=${toHex(sig)}`;
}

export async function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false;
  const expected = await computeMetaSignature(rawBody, appSecret);
  return timingSafeEqual(expected, header.trim().toLowerCase());
}

/** Handshake d'abonnement : Meta appelle GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... */
export function verifyMetaChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get('hub.mode') !== 'subscribe') return null;
  const token = params.get('hub.verify_token') ?? '';
  if (!verifyToken || !timingSafeEqual(token, verifyToken)) return null;
  return params.get('hub.challenge');
}
