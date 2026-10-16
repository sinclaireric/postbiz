// Paramètre `state` : `<nonce>.<signature>`. Le nonce est aléatoire ; la signature HMAC (clé dérivée de
// TOKEN_ENCRYPTION_KEY) permet de rejeter sans accès à la base tout `state` qui ne vient pas de nous.
// Côté base on ne garde que le hachage SHA-256 du `state` : une fuite de la table ne permet pas de le rejouer.
import { randomToken, sha256Hex, toBase64Url } from './pkce.ts';

const enc = new TextEncoder();

function rawKey(keyB64: string): Uint8Array<ArrayBuffer> {
  const s = atob(keyB64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  if (out.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY doit faire 32 octets encodés en base64 (openssl rand -base64 32)');
  return out;
}

async function hmacKey(usage: 'sign' | 'verify', raw: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Sous-clé propre à l'usage « state » (séparation des usages : la clé maître sert aussi au chiffrement des jetons). */
async function subKey(usage: 'sign' | 'verify', keyB64: string) {
  const master = await hmacKey('sign', rawKey(keyB64));
  const derived = new Uint8Array(await crypto.subtle.sign('HMAC', master, enc.encode('postbiz/oauth-state/v1')));
  return hmacKey(usage, new Uint8Array(derived.buffer.slice(0) as ArrayBuffer));
}

export async function createState(keyB64: string): Promise<{ state: string; hash: string }> {
  const nonce = randomToken(24);
  const sig = toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await subKey('sign', keyB64), enc.encode(nonce))));
  const state = `${nonce}.${sig}`;
  return { state, hash: await sha256Hex(state) };
}

/** Vérifie la signature (temps constant). Renvoie le hachage à chercher en base, ou `null` si le `state` est invalide. */
export async function checkState(state: string | null | undefined, keyB64: string): Promise<string | null> {
  if (!state || state.length > 200) return null;
  const [nonce, sig, extra] = state.split('.');
  if (!nonce || !sig || extra !== undefined) return null;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    const padded = sig.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (sig.length % 4)) % 4);
    const s = atob(padded);
    sigBytes = new Uint8Array(new ArrayBuffer(s.length));
    for (let i = 0; i < s.length; i++) sigBytes[i] = s.charCodeAt(i);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await subKey('verify', keyB64), sigBytes, enc.encode(nonce));
  return ok ? sha256Hex(state) : null;
}
