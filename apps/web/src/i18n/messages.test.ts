import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from './config';
import { loadMessages } from './messages';
import { createTranslator, hasPluralSuffix, pluralBase, splitRich, type Messages } from './translate';

/** Aplatit un arbre de messages en { 'a.b.c': 'texte' }. */
function flatten(tree: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[path] = v;
    else Object.assign(out, flatten(v, path));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const tags = (s: string) => splitRich(s).flatMap((p) => (typeof p === 'string' ? [] : [p.tag])).sort();

/** Les textes juridiques ne sont traduits qu'en français et en anglais ; les autres langues n'ont que les 4 clés d'avis. */
const LEGAL_LOCALIZED = new Set(['legal.draftNotice', 'legal.updated', 'legal.datePlaceholder', 'legal.availableIn']);
const isLegalBody = (k: string) => k.startsWith('legal.') && !LEGAL_LOCALIZED.has(k);

let fr: Record<string, string>;
const cache = new Map<Locale, Record<string, string>>();
const flat = async (l: Locale) => {
  if (!cache.has(l)) cache.set(l, flatten(await loadMessages(l)));
  return cache.get(l)!;
};

describe('fichiers de langue', () => {
  it('le français (source) est complet et sans texte vide', async () => {
    fr = await flat('fr');
    expect(Object.keys(fr).length).toBeGreaterThan(600);
    for (const [k, v] of Object.entries(fr)) expect(v.trim(), k).not.toBe('');
  });

  it('l’anglais est complet : même clés que le français', async () => {
    const en = await flat('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(await flat('fr')).sort());
  });

  for (const locale of LOCALES.filter((l) => l !== 'fr')) {
    describe(locale, () => {
      it('a toutes les clés du français, pas une de plus', async () => {
        const src = await flat('fr');
        const got = await flat(locale);
        const srcBases = new Set(Object.keys(src).filter((k) => !isLegalBody(k) || locale === 'en').map(pluralBase));
        const gotBases = new Set(Object.keys(got).map(pluralBase));
        expect([...srcBases].filter((k) => !gotBases.has(k)), 'clés manquantes').toEqual([]);
        expect([...gotBases].filter((k) => !srcBases.has(k)), 'clés en trop').toEqual([]);
      });

      it('chaque message pluriel a une forme « other » et se résout pour tous les nombres', async () => {
        const src = await flat('fr');
        const got = await flat(locale);
        const t = createTranslator(locale, [await loadMessages(locale), await loadMessages('en'), await loadMessages('fr')]);
        const ownTree = createTranslator(locale, [await loadMessages(locale)]);
        const bases = [...new Set(Object.keys(src).filter(hasPluralSuffix).map(pluralBase))];
        expect(bases.length).toBeGreaterThanOrEqual(5);
        for (const base of bases) {
          expect(got[`${base}_other`], `${base}_other`).toBeTruthy();
          for (const count of [0, 1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 100, 101, 1000, 1_000_000]) {
            // résolu dans la langue elle-même (sans retomber sur l'anglais) et sans accolade oubliée
            const text = ownTree.raw(base as never, { count });
            expect(text, `${base} (${count})`).not.toBe(base);
            expect(text).not.toMatch(/\{\w+\}/);
          }
          void t;
        }
      });

      it('garde les mêmes paramètres {…} que le français', async () => {
        const src = await flat('fr');
        const got = await flat(locale);
        for (const [k, v] of Object.entries(got)) {
          const srcKey = hasPluralSuffix(k) ? (src[k] !== undefined ? k : `${pluralBase(k)}_other`) : k;
          if (src[srcKey] === undefined) continue; // clé pluriel propre à la langue (ex. _few)
          expect(placeholders(v), `${locale}:${k}`).toEqual(placeholders(src[srcKey]!).filter((p) => p !== 'count' || placeholders(v).includes('count')));
        }
      });

      it('garde les mêmes balises <…> que le français', async () => {
        const src = await flat('fr');
        const got = await flat(locale);
        for (const [k, v] of Object.entries(got)) {
          const srcKey = hasPluralSuffix(k) ? (src[k] !== undefined ? k : `${pluralBase(k)}_other`) : k;
          if (src[srcKey] === undefined) continue;
          expect(tags(v), `${locale}:${k}`).toEqual(tags(src[srcKey]!));
          expect(v.replace(/<\/?[a-z]+>/g, ''), `${locale}:${k}`).not.toMatch(/[<>]/);
        }
      });

      it('n’a aucun texte vide', async () => {
        for (const [k, v] of Object.entries(await flat(locale))) expect(v.trim(), `${locale}:${k}`).not.toBe('');
      });
    });
  }
});
