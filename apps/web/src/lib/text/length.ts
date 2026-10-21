import type { NetworkId } from '@/lib/inbox/types';

/**
 * Longueur d'un texte telle que le réseau la compte. X compte « pondéré » : la plupart des caractères latins pèsent 1, les émojis, le
 * chinois, le gras Unicode… pèsent 2, un lien pèse toujours 23. Les autres réseaux comptent les caractères (points de code, pas les
 * unités UTF-16 : un 𝗯 en gras vaut 1, pas 2).
 */

const X_URL_WEIGHT = 23;
const URL = /\bhttps?:\/\/[^\s<>"']+/giu;

/** Poids d'un point de code sur X (règles « twitter-text » version 3). */
function xWeight(cp: number): number {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
}

const graphemes = (text: string): string[] => {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  } catch {
    return [...text];
  }
};

const isEmoji = (g: string) => /\p{Extended_Pictographic}/u.test(g);
const xWeightOfGrapheme = (g: string) => (isEmoji(g) ? 2 : [...g].reduce((sum, ch) => sum + xWeight(ch.codePointAt(0)!), 0));

/** Morceaux d'un texte pour X : des liens (atomiques, 23) et du texte. */
function xTokens(text: string): { text: string; link: boolean }[] {
  const out: { text: string; link: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), link: false });
    out.push({ text: m[0], link: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), link: false });
  return out;
}

export function xWeightedLength(text: string): number {
  return xTokens(text).reduce((sum, t) => sum + (t.link ? X_URL_WEIGHT : graphemes(t.text).reduce((s, g) => s + xWeightOfGrapheme(g), 0)), 0);
}

export function countLength(networkId: NetworkId, text: string): number {
  return networkId === 'x' ? xWeightedLength(text) : [...text].length;
}

/** Coupe le texte là où le réseau cesserait de l'accepter : [ce qui passe, ce qui dépasse]. */
export function sliceAtLimit(networkId: NetworkId, text: string, max: number): [string, string] {
  if (countLength(networkId, text) <= max) return [text, ''];
  if (networkId !== 'x') {
    const chars = [...text];
    return [chars.slice(0, max).join(''), chars.slice(max).join('')];
  }
  let used = 0;
  let cut = 0;
  for (const token of xTokens(text)) {
    const parts = token.link ? [token.text] : graphemes(token.text);
    for (const part of parts) {
      const weight = token.link ? X_URL_WEIGHT : xWeightOfGrapheme(part);
      if (used + weight > max) return [text.slice(0, cut), text.slice(cut)];
      used += weight;
      cut += part.length;
    }
  }
  return [text, ''];
}
