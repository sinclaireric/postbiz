/**
 * Gras et souligné dans une publication, à la manière de Postiz : les réseaux n'acceptent pas de texte enrichi, le style s'écrit
 * donc dans le texte lui-même, et ce qu'on voit dans l'éditeur est exactement ce qui sera publié.
 *
 * - gras : les lettres et chiffres latins deviennent des « sans empattement gras » Unicode (𝗕𝗼𝗻𝗷𝗼𝘂𝗿 𝟮𝟬𝟮𝟲) ;
 * - souligné : le caractère combinant « trait bas » (U+0332) suit chaque lettre ou chiffre (B̲o̲n̲j̲o̲u̲r̲).
 *
 * Au-delà de Postiz, qui laisse les lettres accentuées telles quelles : « é », « ç », « ü »… sont décomposées pour que la lettre passe
 * en gras et que son accent la suive. Le style se retire à l'identique : le texte revient à ce qu'il était.
 */

export const UNDERLINE_MARK = '̲';

const BOLD_UPPER = 0x1d5d4; // 𝗔
const BOLD_LOWER = 0x1d5ee; // 𝗮
const BOLD_DIGIT = 0x1d7ec; // 𝟬

export interface TextStyle {
  bold: boolean;
  underline: boolean;
}

export type StyleKind = keyof TextStyle;
export type StyleState = 'none' | 'some' | 'all';

function toBold(cp: number): number | null {
  if (cp >= 65 && cp <= 90) return BOLD_UPPER + (cp - 65);
  if (cp >= 97 && cp <= 122) return BOLD_LOWER + (cp - 97);
  if (cp >= 48 && cp <= 57) return BOLD_DIGIT + (cp - 48);
  return null;
}

function fromBold(cp: number): number | null {
  if (cp >= BOLD_UPPER && cp < BOLD_UPPER + 26) return 65 + (cp - BOLD_UPPER);
  if (cp >= BOLD_LOWER && cp < BOLD_LOWER + 26) return 97 + (cp - BOLD_LOWER);
  if (cp >= BOLD_DIGIT && cp < BOLD_DIGIT + 10) return 48 + (cp - BOLD_DIGIT);
  return null;
}

/** Un caractère et les signes combinants (accents, trait bas) qui le suivent. */
interface Cluster {
  base: string;
  marks: string;
}

const isMark = (ch: string) => /^\p{M}$/u.test(ch);

function clusters(text: string): Cluster[] {
  const out: Cluster[] = [];
  for (const ch of text) {
    const last = out[out.length - 1];
    if (last && isMark(ch)) last.marks += ch;
    else out.push({ base: ch, marks: '' });
  }
  return out;
}

/** « é » devient « e » + accent, pour pouvoir mettre la lettre en gras ; les autres caractères restent tels quels. */
function decompose(c: Cluster): Cluster {
  if (c.base.length === 0 || /^[\x00-\x7f]$/.test(c.base)) return c;
  const nfd = c.base.normalize('NFD');
  return /^[A-Za-z]\p{M}+$/u.test(nfd) ? { base: nfd[0]!, marks: nfd.slice(1) + c.marks } : c;
}

/** La lettre, quelle que soit sa graisse. */
const plainBase = (base: string): string => {
  const cp = base.codePointAt(0)!;
  const plain = fromBold(cp);
  return plain === null ? base : String.fromCodePoint(plain);
};

const canBold = (base: string) => toBold(plainBase(base).codePointAt(0)!) !== null;
/** Lettres et chiffres latins, cyrilliques et grecs : les écritures liées (arabe, hébreu, indiennes) se cassent avec un trait combinant. */
const canUnderline = (base: string) => /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}]$/u.test(plainBase(base));
const isBold = (base: string) => fromBold(base.codePointAt(0)!) !== null;
const isUnderlined = (c: Cluster) => c.marks.includes(UNDERLINE_MARK);

/** Applique le style demandé (sans retirer l'autre). Idempotent : appliquer deux fois donne le même texte. */
export function styleText(text: string, style: Partial<TextStyle>): string {
  if (!style.bold && !style.underline) return text;
  return clusters(text)
    .map((raw) => {
      const c = style.bold ? decompose(raw) : raw;
      let base = c.base;
      let marks = c.marks;
      if (style.bold && canBold(base)) base = String.fromCodePoint(toBold(plainBase(base).codePointAt(0)!)!);
      if (style.underline && canUnderline(c.base) && !marks.includes(UNDERLINE_MARK)) marks += UNDERLINE_MARK;
      return base + marks;
    })
    .join('');
}

/** Retire le style demandé : le texte revient à des lettres normales, accents recomposés. */
export function unstyleText(text: string, which: Partial<TextStyle> = { bold: true, underline: true }): string {
  if (!which.bold && !which.underline) return text;
  return clusters(text)
    .map((c) => {
      const base = which.bold ? plainBase(c.base) : c.base;
      const marks = which.underline ? c.marks.split(UNDERLINE_MARK).join('') : c.marks;
      const changed = base !== c.base || marks !== c.marks;
      return changed ? (base + marks).normalize('NFC') : base + marks;
    })
    .join('');
}

/** Le texte sans aucun style, tel qu'on le donne à l'assistant IA ou qu'on le compare. */
export const plainText = (text: string) => unstyleText(text, { bold: true, underline: true });

/** Le style est-il appliqué à tout le texte, à une partie, ou à rien ? Seuls les caractères qui peuvent le porter comptent. */
export function styleState(text: string, kind: StyleKind): StyleState {
  let total = 0;
  let styled = 0;
  for (const raw of clusters(text)) {
    const c = kind === 'bold' ? decompose(raw) : raw;
    if (kind === 'bold' ? !canBold(c.base) : !canUnderline(c.base)) continue;
    total += 1;
    if (kind === 'bold' ? isBold(c.base) : isUnderlined(c)) styled += 1;
  }
  return total === 0 || styled === 0 ? 'none' : styled === total ? 'all' : 'some';
}

/** Bascule : tout est déjà stylé → on retire ; sinon (rien ou une partie) → on style tout. */
export function toggleStyle(text: string, kind: StyleKind): string {
  return styleState(text, kind) === 'all' ? unstyleText(text, { [kind]: true }) : styleText(text, { [kind]: true });
}

/** Ramène une position de curseur sur une frontière de caractère (jamais au milieu d'une paire de substitution). */
export function snapToCodePoint(text: string, index: number): number {
  const i = Math.max(0, Math.min(index, text.length));
  const code = text.charCodeAt(i);
  return i > 0 && code >= 0xdc00 && code <= 0xdfff && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff ? i - 1 : i;
}
