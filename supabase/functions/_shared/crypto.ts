// Chiffrement des jetons des réseaux (AES-256-GCM). Web Crypto uniquement :
// fonctionne à l'identique dans Node (worker), Deno (Edge Functions) et les tests.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const raw = fromBase64(keyB64);
  if (raw.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY doit faire 32 octets encodés en base64 (openssl rand -base64 32)');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Format : `v1.<iv base64>.<texte chiffré base64>` — le préfixe permet de changer d'algorithme plus tard. */
export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)));
  return `v1.${toBase64(iv)}.${toBase64(ct)}`;
}

export async function decryptSecret(payload: string, keyB64: string): Promise<string> {
  const [version, iv, ct] = payload.split('.');
  if (version !== 'v1' || !iv || !ct) throw new Error('Format de secret chiffré inconnu');
  const key = await importKey(keyB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ct));
  return decoder.decode(plain);
}
