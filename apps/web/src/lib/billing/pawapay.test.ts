import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPaymentPageBody, cleanCustomerMessage, cleanPhone, clearActiveConfCache, createPaymentPage, formatAmount, getActiveCountries, getDeposit, metadataToRecord,
  parseActiveConf, parseDeposit, pawapayConfig,
} from './pawapay.ts';

const ID = '3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10';
const cfg = { token: 'tok', env: 'sandbox' as const, baseUrl: 'https://api.sandbox.pawapay.io' };
const reply = (status: number, body: unknown) => vi.fn(async () => ({ status, ok: status < 300, json: async () => body }) as unknown as Response);
const input = {
  depositId: ID, returnUrl: 'https://getpostbiz.com/app/facturation/retour?depositId=' + ID, amount: 9500, currency: 'XAF', country: 'CM',
  reason: 'Postbiz Standard - 1 mois', customerMessage: 'Postbiz Standard', language: 'FR' as const, metadata: { orgId: 'o1', plan: 'standard' },
};

beforeEach(() => clearActiveConfCache());

describe('configuration', () => {
  it('bac à sable par défaut, production seulement si elle est demandée explicitement', () => {
    expect(pawapayConfig({})).toBeNull();
    expect(pawapayConfig({ PAWAPAY_API_TOKEN: '  ' })).toBeNull();
    expect(pawapayConfig({ PAWAPAY_API_TOKEN: 't' })).toMatchObject({ env: 'sandbox', baseUrl: 'https://api.sandbox.pawapay.io' });
    expect(pawapayConfig({ PAWAPAY_API_TOKEN: 't', PAWAPAY_ENV: 'production' })).toMatchObject({ env: 'production', baseUrl: 'https://api.pawapay.io' });
    expect(pawapayConfig({ PAWAPAY_API_TOKEN: 't', PAWAPAY_ENV: 'live' })).toMatchObject({ env: 'sandbox' });
  });
});

describe('page de paiement', () => {
  it('construit le corps attendu par PawaPay (pays en alpha-3, montant en chaîne, métadonnées en tableau)', () => {
    expect(buildPaymentPageBody(input)).toEqual({
      depositId: ID, returnUrl: input.returnUrl, amountDetails: { amount: '9500', currency: 'XAF' }, country: 'CMR', reason: 'Postbiz Standard - 1 mois',
      customerMessage: 'Postbiz Standard', language: 'FR', metadata: [{ orgId: 'o1' }, { plan: 'standard' }],
    });
  });

  it('respecte les formats de PawaPay : motif ≤ 50, message 4 à 22 caractères sans accents ni ponctuation, montant sans zéro inutile', () => {
    expect((buildPaymentPageBody({ ...input, reason: 'x'.repeat(80) }).reason as string).length).toBe(50);
    expect(cleanCustomerMessage('Postbiz Équipe — Agence !')).toBe('Postbiz Equipe Agence');
    expect(cleanCustomerMessage('Postbiz Standard très long message').length).toBeLessThanOrEqual(22);
    expect(cleanCustomerMessage('Postbiz Standard très long message')).toBe('Postbiz Standard tres');
    expect(cleanCustomerMessage('é')).toBe('Postbiz');
    expect(formatAmount(9500)).toBe('9500');
    expect(formatAmount(16.5)).toBe('16.5');
    expect(() => formatAmount(0)).toThrow();
    expect(() => formatAmount(NaN)).toThrow();
  });

  it('refuse une entrée invalide plutôt que de l’envoyer', () => {
    expect(() => buildPaymentPageBody({ ...input, country: 'FR' })).toThrow(/Pays/);
    expect(() => buildPaymentPageBody({ ...input, depositId: 'abc' })).toThrow(/dépôt/);
    expect(() => buildPaymentPageBody({ ...input, returnUrl: 'http://localhost:3100/x' })).toThrow(/retour/);
    expect(() => buildPaymentPageBody({ ...input, currency: 'xaf' })).toThrow(/Monnaie/);
    expect(() => buildPaymentPageBody({ ...input, reason: '   ' })).toThrow(/Motif/);
    expect(() => buildPaymentPageBody({ ...input, phoneNumber: '12' })).toThrow(/téléphone/);
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']));
    expect(() => buildPaymentPageBody({ ...input, metadata: many })).toThrow(/métadonnées/);
  });

  it('numéro : chiffres seuls avec indicatif', () => {
    expect(cleanPhone('+237 6 70 12 34 56')).toBe('237670123456');
    expect(cleanPhone('00221 77 123 45 67')).toBe('221771234567');
    expect(cleanPhone('0670123456')).toBeNull();
    expect(cleanPhone('abc')).toBeNull();
    expect(cleanPhone(null)).toBeNull();
    expect(buildPaymentPageBody({ ...input, phoneNumber: '+237 670 123 456' }).phoneNumber).toBe('237670123456');
  });

  it('renvoie l’adresse de la page, sinon un code d’échec sans jamais lever', async () => {
    const f = reply(200, { redirectUrl: 'https://pay.pawapay.io/s/abc' });
    expect(await createPaymentPage(cfg, buildPaymentPageBody(input), f)).toEqual({ ok: true, redirectUrl: 'https://pay.pawapay.io/s/abc' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.sandbox.pawapay.io/v2/paymentpage');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');

    expect(await createPaymentPage(cfg, {}, reply(400, { failureReason: { failureCode: 'INVALID_AMOUNT' } }))).toEqual({ ok: false, code: 'INVALID_AMOUNT', transient: false });
    expect(await createPaymentPage(cfg, {}, reply(200, { status: 'REJECTED', failureReason: { failureCode: 'PROVIDER_TEMPORARILY_UNAVAILABLE' } }))).toEqual({ ok: false, code: 'PROVIDER_TEMPORARILY_UNAVAILABLE', transient: true });
    expect(await createPaymentPage(cfg, {}, reply(500, null))).toMatchObject({ ok: false, transient: true });
    expect(await createPaymentPage(cfg, {}, reply(200, { redirectUrl: 'http://evil.test/' }))).toMatchObject({ ok: false });
    expect(await createPaymentPage(cfg, {}, vi.fn(async () => { throw new Error('réseau'); }))).toEqual({ ok: false, code: 'NETWORK', transient: true });
  });
});

describe('relecture d’un dépôt', () => {
  const found = (status: string, extra: Record<string, unknown> = {}) => ({ status: 'FOUND', data: { depositId: ID, status, amount: '9500.00', currency: 'XAF', country: 'CMR', metadata: { orgId: 'o1' }, ...extra } });

  it('COMPLETED : montant, monnaie, pays et métadonnées du dépôt', () => {
    expect(parseDeposit(200, found('COMPLETED'))).toEqual({ state: 'completed', amount: 9500, currency: 'XAF', country: 'CM', metadata: { orgId: 'o1' } });
  });

  it('FAILED et les statuts en cours', () => {
    expect(parseDeposit(200, found('FAILED', { failureReason: { failureCode: 'PAYMENT_NOT_APPROVED' } }))).toEqual({ state: 'failed', code: 'PAYMENT_NOT_APPROVED' });
    for (const s of ['ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION']) expect(parseDeposit(200, found(s))).toEqual({ state: 'pending' });
  });

  it('introuvable : NOT_FOUND ou 404', () => {
    expect(parseDeposit(200, { status: 'NOT_FOUND' })).toEqual({ state: 'not_found' });
    expect(parseDeposit(404, null)).toEqual({ state: 'not_found' });
  });

  it('toute réponse inexploitable ou en panne est une erreur, JAMAIS un échec de paiement', () => {
    for (const [status, body] of [[500, null], [401, { errorCode: 'x' }], [200, null], [200, {}], [200, found('MYSTERE')], [200, found('COMPLETED', { amount: 'abc' })], [200, found('COMPLETED', { currency: 'xaf' })]] as const) {
      expect(parseDeposit(status, body), JSON.stringify([status, body])).toEqual({ state: 'error' });
    }
  });

  it('lit les métadonnées en objet ou en tableau d’objets', () => {
    expect(metadataToRecord({ a: '1', b: 2, c: { d: 1 } })).toEqual({ a: '1', b: '2' });
    expect(metadataToRecord([{ a: '1' }, { b: '2' }])).toEqual({ a: '1', b: '2' });
    expect(metadataToRecord(null)).toEqual({});
  });

  it('getDeposit refuse un identifiant mal formé sans appeler PawaPay, et traduit une panne en erreur', async () => {
    const f = reply(200, found('COMPLETED'));
    expect(await getDeposit(cfg, '../etc/passwd', f)).toEqual({ state: 'not_found' });
    expect(f).not.toHaveBeenCalled();
    expect(await getDeposit(cfg, ID, f)).toMatchObject({ state: 'completed' });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`https://api.sandbox.pawapay.io/v2/deposits/${ID}`);
    expect(await getDeposit(cfg, ID, vi.fn(async () => { throw new Error('délai'); }))).toEqual({ state: 'error' });
  });
});

describe('configuration active (pays couverts)', () => {
  const conf = {
    countries: [
      { country: 'CMR', providers: [{ provider: 'MTN_MOMO_CMR', currencies: [{ currency: 'XAF', operationTypes: { DEPOSIT: { status: 'OPERATIONAL' } } }] }, { provider: 'ORANGE_CMR', currencies: [{ currency: 'XAF', operationTypes: [{ operationType: 'DEPOSIT', status: 'DELAYED' }] }] }] },
      { country: 'GAB', providers: [{ provider: 'AIRTEL_GAB', currencies: [{ currency: 'XAF', operationTypes: { DEPOSIT: { status: 'CLOSED' } } }] }] },
      { country: 'SEN', providers: [{ provider: 'ORANGE_SEN', currencies: [{ currency: 'XOF', operationTypes: { PAYOUT: { status: 'OPERATIONAL' } } }] }] },
      { country: 'RWA', providers: [{ provider: 'MTN_MOMO_RWA', currencies: [{ currency: 'RWF', operationTypes: { DEPOSIT: { status: 'OPERATIONAL' } } }] }] },
    ],
  };

  it('ne garde que les pays où un dépôt est possible (ni fermé, ni payout seul)', () => {
    expect(parseActiveConf(conf)).toEqual([
      { country: 'CM', currencies: ['XAF'], providers: ['MTN_MOMO_CMR', 'ORANGE_CMR'] },
    ]);
    expect(parseActiveConf(null)).toEqual([]);
    expect(parseActiveConf({ countries: 'x' })).toEqual([]);
  });

  it('garde le résultat une heure ; en cas de panne, renvoie null (l’appelant retombe sur la liste par défaut)', async () => {
    const f = reply(200, conf);
    expect((await getActiveCountries(cfg, f, 1_000))?.map((c) => c.country)).toEqual(['CM']);
    await getActiveCountries(cfg, f, 1_000 + 3_000_000);
    expect(f).toHaveBeenCalledTimes(1);
    await getActiveCountries(cfg, f, 1_000 + 3_700_000);
    expect(f).toHaveBeenCalledTimes(2);
    clearActiveConfCache();
    expect(await getActiveCountries(cfg, reply(500, null))).toBeNull();
    expect(await getActiveCountries(cfg, reply(200, { countries: [] }))).toBeNull();
    expect(await getActiveCountries(cfg, vi.fn(async () => { throw new Error('x'); }))).toBeNull();
  });
});
