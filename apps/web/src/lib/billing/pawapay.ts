import { ISO3, iso2From3, normalizeCountry } from './region.ts';

/**
 * Client PawaPay (mobile money) : page de paiement hébergée, relecture d'un dépôt, configuration active.
 * Documentation : https://docs.pawapay.io/v2 (POST /v2/paymentpage, GET /v2/deposits/{id}, GET /v2/active-conf).
 */

export type PawapayEnv = 'sandbox' | 'production';
export const PAWAPAY_URLS: Record<PawapayEnv, string> = { sandbox: 'https://api.sandbox.pawapay.io', production: 'https://api.pawapay.io' };

export interface PawapayConfig {
  token: string;
  env: PawapayEnv;
  baseUrl: string;
}

/**
 * Configuration d'après l'environnement. L'environnement est explicite (`PAWAPAY_ENV=production`) et vaut « sandbox » par défaut : un jeton de
 * production ne déclenche donc jamais de vrai paiement depuis un poste de développement par simple oubli. `null` sans jeton (mode démo).
 */
export function pawapayConfig(env: Record<string, string | undefined> = process.env): PawapayConfig | null {
  const token = env.PAWAPAY_API_TOKEN?.trim();
  if (!token) return null;
  const mode: PawapayEnv = env.PAWAPAY_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  return { token, env: mode, baseUrl: PAWAPAY_URLS[mode] };
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 15_000;

async function call(cfg: PawapayConfig, doFetch: Fetch, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ status: number; body: any } | null> {
  try {
    const res = await doFetch(cfg.baseUrl + path, {
      method: init.method,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- page de paiement

export interface PaymentPageInput {
  depositId: string;
  returnUrl: string;
  /** Montant fixé, dans la monnaie du pays (entier pour les francs CFA). */
  amount: number;
  currency: string;
  /** Pays en alpha-2 : la page ne propose que les portefeuilles de ce pays. */
  country: string;
  reason: string;
  /** Texte du SMS de reçu ou de l'historique du portefeuille. */
  customerMessage: string;
  language: 'EN' | 'FR';
  phoneNumber?: string | null;
  metadata?: Record<string, string>;
}

/** Le montant au format de PawaPay : chaîne, sans zéro inutile (`^([0]|([1-9][0-9]{0,17}))([.][0-9]{0,3}[1-9])?$`). */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) throw new Error('Montant invalide');
  return String(Math.round(n * 1000) / 1000);
}

/** « Postbiz Standard » → texte accepté (4 à 22 caractères, lettres, chiffres et espaces). */
export function cleanCustomerMessage(s: string): string {
  const out = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 22).trim();
  return out.length >= 4 ? out : 'Postbiz';
}

/** Numéro pour PawaPay : chiffres seuls, indicatif compris, ni « + » ni zéro initial. Renvoie null si le numéro n'a pas la forme attendue. */
export function cleanPhone(s: string | null | undefined): string | null {
  const d = (s ?? '').replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  return /^[1-9][0-9]{7,14}$/.test(d) ? d : null;
}

/** Corps de POST /v2/paymentpage. Lève une erreur si une entrée ne respecte pas le format de PawaPay (mieux vaut échouer ici que chez eux). */
export function buildPaymentPageBody(i: PaymentPageInput): Record<string, unknown> {
  const iso3 = ISO3[normalizeCountry(i.country) ?? ''];
  if (!iso3) throw new Error('Pays non pris en charge');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i.depositId)) throw new Error('Identifiant de dépôt invalide');
  if (!/^https:\/\/[^\s]+$/.test(i.returnUrl)) throw new Error('Adresse de retour invalide');
  if (!/^[A-Z]{3}$/.test(i.currency)) throw new Error('Monnaie invalide');
  const reason = i.reason.trim().slice(0, 50);
  if (!reason) throw new Error('Motif manquant');
  const entries = Object.entries(i.metadata ?? {});
  if (entries.length > 10) throw new Error('Trop de métadonnées');
  const phone = i.phoneNumber ? cleanPhone(i.phoneNumber) : null;
  if (i.phoneNumber && !phone) throw new Error('Numéro de téléphone invalide');
  return {
    depositId: i.depositId,
    returnUrl: i.returnUrl,
    amountDetails: { amount: formatAmount(i.amount), currency: i.currency },
    country: iso3,
    reason,
    customerMessage: cleanCustomerMessage(i.customerMessage),
    language: i.language,
    ...(phone ? { phoneNumber: phone } : {}),
    ...(entries.length ? { metadata: entries.map(([k, v]) => ({ [k]: String(v).slice(0, 100) })) } : {}),
  };
}

export type PaymentPageResult = { ok: true; redirectUrl: string } | { ok: false; code: string; transient: boolean };

export async function createPaymentPage(cfg: PawapayConfig, body: Record<string, unknown>, doFetch: Fetch = fetch): Promise<PaymentPageResult> {
  const r = await call(cfg, doFetch, '/v2/paymentpage', { method: 'POST', body });
  if (!r) return { ok: false, code: 'NETWORK', transient: true };
  const url = r.body?.redirectUrl;
  if (r.status >= 200 && r.status < 300 && typeof url === 'string' && /^https:\/\//.test(url)) return { ok: true, redirectUrl: url };
  const code = String(r.body?.failureReason?.failureCode ?? r.body?.errorCode ?? `HTTP_${r.status}`).slice(0, 80);
  return { ok: false, code, transient: r.status >= 500 || code === 'PROVIDER_TEMPORARILY_UNAVAILABLE' };
}

// ---------------------------------------------------------------- relecture d'un dépôt

export type DepositState =
  | { state: 'completed'; amount: number; currency: string; country: string | null; metadata: Record<string, string> }
  | { state: 'failed'; code: string }
  | { state: 'pending' }
  | { state: 'not_found' }
  /** Réponse inexploitable ou panne : on ne conclut RIEN (jamais « échoué ») et on relira plus tard. */
  | { state: 'error' };

/** Les métadonnées reviennent en objet (GET) ou en tableau d'objets à une clé (rappel) : on accepte les deux. */
export function metadataToRecord(m: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (o: unknown) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  };
  if (Array.isArray(m)) m.forEach(put);
  else put(m);
  return out;
}

/** Lit la réponse de GET /v2/deposits/{id}. */
export function parseDeposit(status: number, body: any): DepositState {
  if (status === 404) return { state: 'not_found' };
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { state: 'error' };
  if (body.status === 'NOT_FOUND') return { state: 'not_found' };
  const d = body.status === 'FOUND' ? body.data : null;
  if (!d || typeof d !== 'object') return { state: 'error' };
  switch (d.status) {
    case 'COMPLETED': {
      const amount = Number(d.amount ?? d.amountDetails?.amount);
      const currency = String(d.currency ?? d.amountDetails?.currency ?? '');
      if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) return { state: 'error' };
      return { state: 'completed', amount, currency, country: typeof d.country === 'string' ? iso2From3(d.country) : null, metadata: metadataToRecord(d.metadata) };
    }
    case 'FAILED':
      return { state: 'failed', code: String(d.failureReason?.failureCode ?? 'UNSPECIFIED_FAILURE').slice(0, 80) };
    case 'ACCEPTED':
    case 'PROCESSING':
    case 'IN_RECONCILIATION':
      return { state: 'pending' };
    default:
      return { state: 'error' };
  }
}

export async function getDeposit(cfg: PawapayConfig, depositId: string, doFetch: Fetch = fetch): Promise<DepositState> {
  if (!/^[0-9a-f-]{36}$/i.test(depositId)) return { state: 'not_found' };
  const r = await call(cfg, doFetch, `/v2/deposits/${encodeURIComponent(depositId)}`, { method: 'GET' });
  return r ? parseDeposit(r.status, r.body) : { state: 'error' };
}

// ---------------------------------------------------------------- configuration active

export interface ActiveCountry {
  /** Alpha-2. */
  country: string;
  currencies: string[];
  providers: string[];
}

/** Pays où un dépôt est possible, d'après GET /v2/active-conf. */
export function parseActiveConf(body: any): ActiveCountry[] {
  const out: ActiveCountry[] = [];
  for (const c of Array.isArray(body?.countries) ? body.countries : []) {
    const country = typeof c?.country === 'string' ? iso2From3(c.country) : null;
    if (!country) continue;
    const providers: string[] = [];
    const currencies = new Set<string>();
    for (const p of Array.isArray(c.providers) ? c.providers : []) {
      for (const cur of Array.isArray(p?.currencies) ? p.currencies : []) {
        const ops = cur?.operationTypes;
        const deposit = Array.isArray(ops) ? ops.find((o: any) => o?.operationType === 'DEPOSIT') : ops?.DEPOSIT;
        const status = deposit?.status;
        if (deposit && status !== 'CLOSED' && typeof cur.currency === 'string') {
          currencies.add(cur.currency);
          if (typeof p.provider === 'string' && !providers.includes(p.provider)) providers.push(p.provider);
        }
      }
    }
    if (providers.length) out.push({ country, currencies: [...currencies], providers });
  }
  return out;
}

let confCache: { at: number; key: string; countries: ActiveCountry[] } | null = null;
const CONF_MS = 3_600_000;

/** Pays où le mobile money est actif sur le compte PawaPay (gardé une heure). `null` si PawaPay ne répond pas : l'appelant retombe sur la liste par défaut. */
export async function getActiveCountries(cfg: PawapayConfig, doFetch: Fetch = fetch, now: number = Date.now()): Promise<ActiveCountry[] | null> {
  const key = `${cfg.env}`;
  if (confCache && confCache.key === key && now - confCache.at < CONF_MS) return confCache.countries;
  const r = await call(cfg, doFetch, '/v2/active-conf?operationType=DEPOSIT', { method: 'GET' });
  if (!r || r.status !== 200) return null;
  const countries = parseActiveConf(r.body);
  if (!countries.length) return null;
  confCache = { at: now, key, countries };
  return countries;
}
export const clearActiveConfCache = () => { confCache = null; };
