import { describe, expect, it } from 'vitest';
import { LOCALES } from './config';
import { matchTag, negotiateLocale, parseAcceptLanguage } from './negotiate';

describe('parseAcceptLanguage', () => {
  it('trie par préférence (q), en gardant l’ordre à égalité', () => {
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8,de;q=0.7')).toEqual(['fr-FR', 'fr', 'en', 'de']);
    expect(parseAcceptLanguage('en;q=0.5, de, es;q=0.5')).toEqual(['de', 'en', 'es']);
  });
  it('ignore les langues refusées (q=0) et les valeurs vides', () => {
    expect(parseAcceptLanguage('fr;q=0, en')).toEqual(['en']);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
});

describe('matchTag', () => {
  it('reconnaît les 14 langues', () => {
    for (const l of LOCALES) expect(matchTag(l)).toBe(l);
  });
  it('ramène une variante régionale à sa langue', () => {
    expect(matchTag('fr-CA')).toBe('fr');
    expect(matchTag('pt-BR')).toBe('pt');
    expect(matchTag('zh-TW')).toBe('zh');
    expect(matchTag('zh-Hans-CN')).toBe('zh');
    expect(matchTag('ES-mx')).toBe('es');
    expect(matchTag('ar-EG')).toBe('ar');
  });
  it('comprend l’ancien code de l’hébreu', () => expect(matchTag('iw')).toBe('he'));
  it('refuse ce qui n’est pas géré', () => {
    for (const bad of ['nl', 'sv', '*', '', 'xx-YY']) expect(matchTag(bad)).toBeNull();
  });
});

describe('negotiateLocale', () => {
  it('le choix explicite (cookie) l’emporte sur le navigateur', () => {
    expect(negotiateLocale({ cookie: 'ja', acceptLanguage: 'fr-FR,fr;q=0.9' })).toBe('ja');
  });
  it('un cookie invalide est ignoré', () => {
    expect(negotiateLocale({ cookie: 'klingon', acceptLanguage: 'de-DE' })).toBe('de');
    expect(negotiateLocale({ cookie: '', acceptLanguage: null })).toBe('en');
  });
  it('prend la première langue du navigateur que nous gérons', () => {
    expect(negotiateLocale({ acceptLanguage: 'nl-NL,nl;q=0.9,it;q=0.8,en;q=0.5' })).toBe('it');
  });
  it('retombe sur l’anglais sinon', () => {
    expect(negotiateLocale({ acceptLanguage: 'nl,sv' })).toBe('en');
    expect(negotiateLocale({})).toBe('en');
  });
});
