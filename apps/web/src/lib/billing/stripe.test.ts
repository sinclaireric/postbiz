import { describe, expect, it, vi } from 'vitest';
import { formEncode, priceLookupKey, signStripePayload, stripeCall, stripeConfig, subscriptionPeriodEnd, verifyStripeSignature } from './stripe.ts';

const SECRET = 'whsec_test_secret_value';
const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
const NOW = 1_800_000_000_000;
const sig = (payload = body, secret = SECRET, t = NOW / 1000) => signStripePayload(payload, secret, t);

describe('clés', () => {
  it('reconnaît le mode de test et refuse tout ce qui n’est pas une clé Stripe', () => {
    expect(stripeConfig({})).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'abc' })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'pk_test_abc' })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc123' })).toMatchObject({ mode: 'test', webhookSecrets: [] });
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'rk_test_abc123' })).toMatchObject({ mode: 'test' });
  });

  it('une clé de production ne sert que sur le serveur de production', () => {
    const live = { STRIPE_SECRET_KEY: 'sk_live_abc123' };
    expect(stripeConfig({ ...live, NODE_ENV: 'development' })).toBeNull();
    expect(stripeConfig({ ...live })).toBeNull();
    expect(stripeConfig({ ...live, NODE_ENV: 'production' })).toMatchObject({ mode: 'live' });
    expect(stripeConfig({ ...live, NODE_ENV: 'development', BILLING_ALLOW_LIVE_IN_DEV: '1' })).toMatchObject({ mode: 'live' });
  });

  it('accepte plusieurs secrets de signature (rotation) et ignore ce qui n’en est pas un', () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_one, whsec_two ,nope' })?.webhookSecrets).toEqual(['whsec_one', 'whsec_two']);
  });
});

describe('signature des webhooks', () => {
  it('accepte une signature valide', () => {
    expect(verifyStripeSignature(body, sig(), [SECRET], NOW)).toEqual({ ok: true, timestamp: NOW / 1000 });
  });

  it('refuse un corps modifié, un autre secret, un en-tête absent ou mal formé', () => {
    expect(verifyStripeSignature(body + ' ', sig(), [SECRET], NOW)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyStripeSignature(body, sig(body, 'whsec_autre'), [SECRET], NOW)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyStripeSignature(body, null, [SECRET], NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyStripeSignature(body, '', [SECRET], NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyStripeSignature(body, 'n importe quoi', [SECRET], NOW)).toEqual({ ok: false, reason: 'format' });
    expect(verifyStripeSignature(body, `t=${NOW / 1000}`, [SECRET], NOW)).toEqual({ ok: false, reason: 'format' });
    expect(verifyStripeSignature(body, `t=${NOW / 1000},v1=zz`, [SECRET], NOW)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyStripeSignature(body, sig(), [], NOW)).toEqual({ ok: false, reason: 'no-secret' });
  });

  it('refuse un horodatage trop ancien ou lointain (rejeu), accepte dans les 5 minutes', () => {
    expect(verifyStripeSignature(body, sig(body, SECRET, NOW / 1000 - 301), [SECRET], NOW)).toEqual({ ok: false, reason: 'tolerance' });
    expect(verifyStripeSignature(body, sig(body, SECRET, NOW / 1000 + 301), [SECRET], NOW)).toEqual({ ok: false, reason: 'tolerance' });
    expect(verifyStripeSignature(body, sig(body, SECRET, NOW / 1000 - 299), [SECRET], NOW).ok).toBe(true);
  });

  it('un horodatage modifié invalide la signature (il en fait partie)', () => {
    const forged = sig().replace(/^t=\d+/, `t=${NOW / 1000 + 1}`);
    expect(verifyStripeSignature(body, forged, [SECRET], NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('plusieurs signatures v1 (secret en rotation) et la v0 de test sont gérées', () => {
    const a = sig(body, 'whsec_ancien');
    const b = sig(body, SECRET);
    const merged = `${a},${b.split(',')[1]},v0=${'0'.repeat(64)}`;
    expect(verifyStripeSignature(body, merged, [SECRET], NOW).ok).toBe(true);
    expect(verifyStripeSignature(body, a, ['whsec_nouveau', 'whsec_ancien'], NOW).ok).toBe(true);
    expect(verifyStripeSignature(body, `t=${NOW / 1000},v0=${'a'.repeat(64)}`, [SECRET], NOW)).toEqual({ ok: false, reason: 'format' });
  });
});

describe('requêtes', () => {
  it('encode les formulaires à la manière de Stripe', () => {
    expect(formEncode({ mode: 'subscription', line_items: [{ quantity: 1, price_data: { currency: 'xof', unit_amount: 9500 } }], skip: undefined, none: null, flag: true }))
      .toBe('mode=subscription&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=xof&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=9500&flag=true');
  });

  it('appelle l’API avec la clé en en-tête, jamais dans l’adresse', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) }) as unknown as Response);
    expect(await stripeCall({ secretKey: 'sk_test_zzz' }, 'POST', '/v1/checkout/sessions', { mode: 'subscription' }, f)).toEqual({ ok: true, data: { id: 'x' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_zzz');
    expect(init.body).toBe('mode=subscription');
    await stripeCall({ secretKey: 'sk_test_zzz' }, 'GET', '/v1/prices', { limit: 1 }, f);
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe('https://api.stripe.com/v1/prices?limit=1');
  });

  it('traduit les erreurs de l’API et du réseau sans lever', async () => {
    const err = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 'currency_not_supported', message: 'Currency xaf is not supported' } }) }) as unknown as Response);
    expect(await stripeCall({ secretKey: 'k' }, 'POST', '/v1/x', {}, err)).toEqual({ ok: false, status: 400, code: 'currency_not_supported', message: 'Currency xaf is not supported', transient: false });
    const down = vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new Error('html'); } }) as unknown as Response);
    expect(await stripeCall({ secretKey: 'k' }, 'GET', '/v1/x', {}, down)).toMatchObject({ ok: false, status: 503, transient: true });
    expect(await stripeCall({ secretKey: 'k' }, 'GET', '/v1/x', {}, vi.fn(async () => { throw new Error('réseau'); }))).toMatchObject({ ok: false, code: 'network', transient: true });
  });

  it('clé de recherche et fin de période (ancienne et nouvelle forme de l’API)', () => {
    expect(priceLookupKey('team', 'yearly')).toBe('postbiz_team_yearly');
    expect(subscriptionPeriodEnd({ current_period_end: 1_800_000_000 })).toBe(1_800_000_000);
    expect(subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1_800_000_500 }] } })).toBe(1_800_000_500);
    expect(subscriptionPeriodEnd({})).toBeNull();
    expect(subscriptionPeriodEnd(null)).toBeNull();
  });
});
