// Longueur d'un texte telle que le réseau la compte : le même calcul que le web (apps/web/src/lib/text/length.ts), pour que l'agent applique
// sur le téléphone exactement les limites qu'il applique sur le site. X compte « pondéré » : la plupart des caractères latins pèsent 1,
// les émojis, le chinois, le gras Unicode… pèsent 2, un lien pèse toujours 23. Les autres réseaux comptent les caractères
// (points de code, pas les unités UTF-16).

const X_URL_WEIGHT = 23;
const URL = /\bhttps?:\/\/[^\s<>"']+/giu;

/** Poids d'un point de code sur X (règles « twitter-text » version 3). */
function xWeight(cp: number): number {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
}

const graphemes = (text: string): string[] => {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
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

export function countLength(network: string, text: string): number {
  return network === "x" ? xWeightedLength(text) : [...text].length;
}
