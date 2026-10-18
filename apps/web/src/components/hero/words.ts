import { LOCALE_META } from '@/i18n/config';
import type { Locale } from '@/i18n/config';
import type { RichPart } from '@/i18n/translate';

export interface Token {
  text: string;
  accent: boolean;
  /** Un espace précède le mot (les écritures sans espaces n'en ont pas). */
  space: boolean;
}

const SPACES = /^\s+$/;
/** Japonais et chinois s'écrivent sans espaces : on découpe en mots avec Intl.Segmenter pour pouvoir les faire apparaître un à un. */
const SEGMENTED: Locale[] = ['ja', 'zh'];

/** Découpe les morceaux d'un titre en mots, chacun avec son éventuel espace avant ; les balises (`<accent>`) marquent des mots « accent ». */
export function tokenize(parts: RichPart[], locale: Locale): Token[] {
  const segment = SEGMENTED.includes(locale) && typeof Intl.Segmenter === 'function';
  const out: Token[] = [];
  let space = false;
  for (const part of parts) {
    const accent = typeof part !== 'string';
    const text = typeof part === 'string' ? part : part.text;
    const pieces = segment
      ? [...new Intl.Segmenter(LOCALE_META[locale].tag, { granularity: 'word' }).segment(text)].map((s) => ({ s: s.segment, word: !!s.isWordLike }))
      : text.split(/(\s+)/).filter(Boolean).map((s) => ({ s, word: !SPACES.test(s) }));
    for (const { s, word } of pieces) {
      if (SPACES.test(s)) {
        space = true;
        continue;
      }
      const last = out[out.length - 1];
      if (segment && !word && last && !space) {
        // Ponctuation collée au mot précédent : elle ne doit jamais ouvrir une ligne.
        last.text += s;
        continue;
      }
      out.push({ text: s, accent, space });
      space = false;
    }
  }
  return out;
}
