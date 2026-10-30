/**
 * Les caractères qu'une personne ne voit pas mais qu'un modèle lit : étiquettes Unicode (« ASCII smuggling »), contrôles bidirectionnels, espaces de largeur
 * nulle, sélecteurs de variante supplémentaires, caractères de contrôle. Un document ou une page web peut y cacher des consignes à l'IA ; on les retire de tout
 * texte lu. Restent le saut de ligne, la tabulation et le saut de page (séparateur des pages d'un PDF), ainsi que U+200C et U+200D (nécessaires à l'écriture
 * de plusieurs langues et aux émojis composés).
 */
const INVISIBLE = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;
/** Espaces de toute largeur : ramenés à l'espace simple. */
const SPACES = /[   -   　]/g;

/** Texte propre : fins de ligne uniformes, caractères invisibles retirés, espaces réduits, jamais plus d'une ligne vide de suite. */
export function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(SPACES, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .normalize('NFC')
    .trim();
}

/** Coupe à `max` signes (points de code), avec une ellipse si le texte est plus long. */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** Un aperçu d'une ligne : sans marques d'intertitre ni de liste, coupé à `max` signes. */
export function previewOf(text: string, max = 600): string {
  const flat = text
    .replace(/\f/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*•▪◦]\s+)/, '').trim())
    .filter(Boolean)
    .join(' ');
  return truncate(flat.replace(/\s+/g, ' ').trim(), max);
}

/** Le titre d'une source d'après le nom du fichier : sans extension, sans traits de liaison, au plus 120 signes. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return truncate(base || name.trim() || 'Document', 120);
}
