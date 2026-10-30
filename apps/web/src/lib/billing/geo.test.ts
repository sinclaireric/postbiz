import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGeoCache, clientIp, countryFromHeaders, countryFromLookup, lookupCountryByIp, parseRegionCookie, resolveCountry } from './geo.ts';
import { iso2From3, mobileMoneyAvailable, normalizeCountry, regionOf } from './region.ts';

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
const json = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

beforeEach(() => clearGeoCache());

describe('régions de prix', () => {
  it('les 14 pays des francs CFA : XAF pour la CEMAC, XOF pour l’UEMOA, avec rabais', () => {
    for (const c of ['CM', 'GA', 'TD', 'CG', 'CF', 'GQ']) expect(regionOf(c)).toMatchObject({ zone: 'xaf', currency: 'XAF', discounted: true, country: c });
    for (const c of ['SN', 'CI', 'TG', 'BJ', 'BF', 'ML', 'NE', 'GW']) expect(regionOf(c)).toMatchObject({ zone: 'xof', currency: 'XOF', discounted: true, country: c });
  });

  it('RDC : dollars avec rabais ; ailleurs : dollars sans rabais', () => {
    expect(regionOf('CD')).toMatchObject({ zone: 'cd', currency: 'USD', discounted: true });
    expect(regionOf('FR')).toMatchObject({ zone: 'world', currency: 'USD', discounted: false, country: 'FR' });
    expect(regionOf(null)).toMatchObject({ zone: 'world', currency: 'USD', discounted: false, country: null });
    expect(regionOf('cm').country).toBe('CM');
  });

  it('les codes qui ne sont pas des pays sont ignorés', () => {
    for (const bad of ['XX', 'T1', 'ZZ', '', 'FRA', '1A', 'c', undefined, null]) expect(normalizeCountry(bad as string)).toBeNull();
  });

  it('le mobile money suit la liste des pays actifs chez PawaPay', () => {
    expect(mobileMoneyAvailable('CM')).toBe(true);
    expect(mobileMoneyAvailable('TD')).toBe(false); // Tchad : carte seulement
    expect(mobileMoneyAvailable('TG')).toBe(false); // Togo : carte seulement
    expect(mobileMoneyAvailable('CD')).toBe(false); // RDC : pas activée
    expect(mobileMoneyAvailable('CD', ['CD'])).toBe(true);
    expect(mobileMoneyAvailable(null)).toBe(false);
  });

  it('convertit les codes pays de PawaPay', () => {
    expect(iso2From3('CMR')).toBe('CM');
    expect(iso2From3('cog')).toBe('CG');
    expect(iso2From3('XYZ')).toBeNull();
  });
});

describe('détection du pays', () => {
  it('lit l’en-tête de l’hébergeur (Vercel, puis Cloudflare)', () => {
    expect(countryFromHeaders(headers({ 'x-vercel-ip-country': 'SN' }))).toBe('SN');
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'ci' }))).toBe('CI');
    expect(countryFromHeaders(headers({ 'x-vercel-ip-country': 'XX', 'cf-ipcountry': 'BJ' }))).toBe('BJ');
    expect(countryFromHeaders(headers({}))).toBeNull();
  });

  it('le cookie de choix de la personne vaut avant tout, y compris « autre pays »', () => {
    expect(parseRegionCookie('CM')).toBe('CM');
    expect(parseRegionCookie('ZZ')).toBe('ZZ');
    expect(parseRegionCookie('<script>')).toBeNull();
    expect(parseRegionCookie(undefined)).toBeNull();
  });

  it('extrait l’adresse du visiteur, jamais une adresse privée ni mal formée', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '41.202.10.5, 10.0.0.1' }))).toBe('41.202.10.5');
    expect(clientIp(headers({ 'x-real-ip': '2a01:e0a::1' }))).toBe('2a01:e0a::1');
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '172.20.0.1', '::1', 'pas une ip', '1.2.3.4;rm -rf']) {
      expect(clientIp(headers({ 'x-forwarded-for': ip })), ip).toBeNull();
    }
    expect(clientIp(headers({}))).toBeNull();
  });

  it('lit le pays dans les formes de réponse des services courants', () => {
    expect(countryFromLookup({ success: true, country_code: 'CM' })).toBe('CM');
    expect(countryFromLookup({ countryCode: 'ga' })).toBe('GA');
    expect(countryFromLookup({ country: 'TD' })).toBe('TD');
    expect(countryFromLookup({ success: false, country_code: 'CM' })).toBeNull();
    expect(countryFromLookup({ country: 'Cameroun' })).toBeNull();
    expect(countryFromLookup(null)).toBeNull();
    expect(countryFromLookup('CM')).toBeNull();
  });

  it('interroge le service avec un délai court et garde le résultat en mémoire', async () => {
    const f = json({ success: true, country_code: 'SN' });
    expect(await lookupCountryByIp('41.82.0.1', { fetch: f, urlTemplate: 'https://geo.test/{ip}' })).toBe('SN');
    expect(await lookupCountryByIp('41.82.0.1', { fetch: f, urlTemplate: 'https://geo.test/{ip}' })).toBe('SN');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://geo.test/41.82.0.1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('ne lève jamais : erreur réseau, délai dépassé, réponse invalide ou service mal configuré donnent null', async () => {
    const boom = vi.fn(async () => { throw new Error('réseau'); });
    expect(await lookupCountryByIp('1.1.1.1', { fetch: boom, urlTemplate: 'https://geo.test/{ip}' })).toBeNull();
    const timeout = vi.fn(async () => { throw new DOMException('délai', 'TimeoutError'); });
    expect(await lookupCountryByIp('1.1.1.2', { fetch: timeout, urlTemplate: 'https://geo.test/{ip}' })).toBeNull();
    expect(await lookupCountryByIp('1.1.1.3', { fetch: json({}, false), urlTemplate: 'https://geo.test/{ip}' })).toBeNull();
    const notJson = vi.fn(async () => ({ ok: true, json: async () => { throw new Error('pas du JSON'); } }) as unknown as Response);
    expect(await lookupCountryByIp('1.1.1.4', { fetch: notJson, urlTemplate: 'https://geo.test/{ip}' })).toBeNull();
    const never = vi.fn();
    expect(await lookupCountryByIp('1.1.1.5', { fetch: never, urlTemplate: 'http://geo.test/{ip}' })).toBeNull(); // http refusé
    expect(await lookupCountryByIp('1.1.1.6', { fetch: never, urlTemplate: 'https://geo.test/fixe' })).toBeNull(); // sans {ip}
    expect(never).not.toHaveBeenCalled();
  });

  it('précédence : cookie, puis hébergeur, puis adresse IP (seulement si l’hébergeur ne dit rien), puis rien', async () => {
    const f = json({ country_code: 'TD' });
    const lookup = { fetch: f, urlTemplate: 'https://geo.test/{ip}' };
    const h = headers({ 'x-vercel-ip-country': 'SN', 'x-forwarded-for': '41.82.0.9' });
    expect(await resolveCountry({ cookie: 'CM', headers: h, lookup })).toEqual({ country: 'CM', source: 'cookie' });
    expect(await resolveCountry({ cookie: 'ZZ', headers: h, lookup })).toEqual({ country: 'ZZ', source: 'cookie' });
    expect(await resolveCountry({ headers: h, lookup })).toEqual({ country: 'SN', source: 'host' });
    expect(f).not.toHaveBeenCalled(); // l'adresse n'est pas envoyée à un tiers quand l'hébergeur répond
    expect(await resolveCountry({ headers: headers({ 'x-forwarded-for': '41.82.0.9' }), lookup })).toEqual({ country: 'TD', source: 'ip' });
    expect(await resolveCountry({ headers: headers({}), lookup })).toEqual({ country: null, source: 'none' });
    expect(await resolveCountry({ headers: headers({ 'x-forwarded-for': '10.0.0.1' }), lookup })).toEqual({ country: null, source: 'none' });
  });

  it('une panne du service n’empêche pas de résoudre', async () => {
    const boom = vi.fn(async () => { throw new Error('panne'); });
    expect(await resolveCountry({ headers: headers({ 'x-forwarded-for': '41.82.0.10' }), lookup: { fetch: boom, urlTemplate: 'https://geo.test/{ip}' } })).toEqual({ country: null, source: 'none' });
  });
});
