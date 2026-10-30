import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Client Stripe minimal (REST + formulaires, sans dépendance) : sessions Checkout d'abonnement, portail client, lecture d'un abonnement,
 * prix par clé de recherche, et vérification de la signature des webhooks. Documentation : https://docs.stripe.com/api
 */

export type StripeMode = 'test' | 'live';
export interface StripeConfig {
  secretKey: string;
  mode: StripeMode;
  /** Secrets de signature (plusieurs pendant une rotation, séparés par des virgules dans STRIPE_WEBHOOK_SECRET). */
  webhookSecrets: string[];
}

/**
 * Configuration d'après l'environnement. Une clé de production n'est utilisée que sur le serveur de production (NODE_ENV=production) : depuis un
 * poste de développement, elle est ignorée sauf `BILLING_ALLOW_LIVE_IN_DEV=1`. `null` sans clé utilisable (mode démo).
 */
export function stripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const key = env.STRIPE_SECRET_KEY?.trim();
  const m = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(key ?? '');
  if (!key || !m) return null;
  const mode = m[1] as StripeMode;
  if (mode === 'live' && env.NODE_ENV !== 'production' && env.BILLING_ALLOW_LIVE_IN_DEV !== '1') return null;
  const webhookSecrets = (env.STRIPE_WEBHOOK_SECRET ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('whsec_'));
  return { secretKey: key, mode, webhookSecrets };
}

// ---------------------------------------------------------------- signature des webhooks

export type SignatureResult = { ok: true; timestamp: number } | { ok: false; reason: 'missing' | 'format' | 'tolerance' | 'mismatch' | 'no-secret' };

/** Vérifie l'en-tête `Stripe-Signature` : HMAC-SHA256 de « t.corps » avec le secret du point d'accès, comparé en temps constant, dans la tolérance donnée (5 min). */
export function verifyStripeSignature(payload: string, header: string | null | undefined, secrets: string[], now: number = Date.now(), toleranceSec = 300): SignatureResult {
  if (!secrets.length) return { ok: false, reason: 'no-secret' };
  if (!header) return { ok: false, reason: 'missing' };
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1') v1.push(v);
  }
  if (!Number.isInteger(t) || t <= 0 || !v1.length) return { ok: false, reason: 'format' };
  if (Math.abs(now / 1000 - t) > toleranceSec) return { ok: false, reason: 'tolerance' };
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest();
    for (const sig of v1) {
      if (!/^[0-9a-f]{64}$/i.test(sig)) continue;
      if (timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return { ok: true, timestamp: t };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

/** Signe un corps comme Stripe (tests, et rejeu local d'événements). */
export function signStripePayload(payload: string, secret: string, timestampSec: number): string {
  return `t=${timestampSec},v1=${createHmac('sha256', secret).update(`${timestampSec}.${payload}`).digest('hex')}`;
}

// ---------------------------------------------------------------- appels

type Fetch = typeof fetch;
type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

/** Encodage `application/x-www-form-urlencoded` de Stripe : `a[b]=1`, `a[0]=x`. */
export function formEncode(params: { [k: string]: Param }): string {
  const pairs: string[] = [];
  const walk = (prefix: string, v: Param) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(`${prefix}[${k}]`, x);
    else pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return pairs.join('&');
}

export type StripeResult<T = any> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; transient: boolean };

export async function stripeCall<T = any>(
  cfg: Pick<StripeConfig, 'secretKey'>, method: 'GET' | 'POST', path: string, params: { [k: string]: Param } = {}, doFetch: Fetch = fetch,
): Promise<StripeResult<T>> {
  const query = method === 'GET' ? formEncode(params) : '';
  try {
    const res = await doFetch(`https://api.stripe.com${path}${query ? `?${query}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.secretKey}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? formEncode(params) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    const body: any = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const err = body?.error ?? {};
    return { ok: false, status: res.status, code: String(err.code ?? err.type ?? `http_${res.status}`).slice(0, 80), message: String(err.message ?? '').slice(0, 300), transient: res.status >= 500 || res.status === 429 };
  } catch {
    return { ok: false, status: 0, code: 'network', message: '', transient: true };
  }
}

/** Clé de recherche d'un prix : `postbiz_team_yearly`. */
export const priceLookupKey = (plan: string, interval: 'monthly' | 'yearly') => `postbiz_${plan}_${interval}`;

/** Lecture de `current_period_end` : sur l'abonnement (anciennes versions de l'API) ou sur ses lignes (versions récentes). */
export function subscriptionPeriodEnd(sub: any): number | null {
  const n = Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end);
  return Number.isFinite(n) && n > 0 ? n : null;
}
