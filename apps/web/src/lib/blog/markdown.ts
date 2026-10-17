/**
 * Markdown des articles → arbre de blocs, sans HTML brut : le rendu se fait en éléments React (components/blog/markdown.tsx),
 * donc un article ne peut pas injecter de balise ni de script, même si son texte en contient.
 *
 * Syntaxe prise en charge : titres (# à ####), paragraphes, listes (à puces ou numérotées, imbriquées), citations,
 * encadrés (`> [!TIP]`, `> [!NOTE]`, `> [!WARNING]`), blocs de code, tableaux, images seules sur une ligne, séparateurs,
 * et en ligne : **gras**, *italique*, `code`, [liens](url).
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] };

export type CalloutKind = 'tip' | 'note' | 'warning';
export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  /** Texte de l'élément. */
  children: Inline[];
  /** Ce qui suit dans l'élément : sous-listes, paragraphes supplémentaires. */
  blocks: Block[];
}

export type Block =
  | { t: 'heading'; level: 2 | 3 | 4; id: string; children: Inline[]; text: string }
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; children: Block[] }
  | { t: 'callout'; kind: CalloutKind; children: Block[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][]; align: Align[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'hr' };

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3 | 4;
}

/** Adresse de lien ou d'image acceptée : relative au site, ancre, https, mailto. Tout le reste (javascript:, data:…) est refusé. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h) || h.startsWith('#')) return h;
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  return null;
}

const safeSrc = (src: string): string | null => {
  const s = src.trim();
  return /^\/(?!\/)/.test(s) || /^https:\/\//i.test(s) ? s : null;
};

/** Identifiant d'ancre d'un titre : minuscules, sans accents, lettres et chiffres séparés par des tirets. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------------------------------------------------
// En ligne

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|>~]/;
const LINK = /\[((?:[^[\]\\]|\\.)*)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)/y;

/** Cherche la marque de fermeture d'un gras ou d'un italique : collée au dernier mot, hors codes et liens. */
function findClosing(src: string, from: number, mark: string): number {
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) i = end;
      continue;
    }
    if (!src.startsWith(mark, i)) continue;
    if (/\s/.test(src[i - 1] ?? ' ')) continue;
    // `_` ne ferme pas au milieu d'un mot (snake_case) ; `*` ne ferme pas sur une marque plus longue (** dans *…*)
    if (mark[0] === '_' && /[\p{L}\p{N}]/u.test(src[i + mark.length] ?? '')) continue;
    if (mark.length === 1 && src[i + 1] === mark) continue;
    return i;
  }
  return -1;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;

    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if ((c === '*' || c === '_') && !/\s/.test(src[i + 1] ?? ' ')) {
      const double = src[i + 1] === c;
      const mark = double ? c + c : c;
      const startsWord = c === '*' || !/[\p{L}\p{N}]/u.test(src[i - 1] ?? ' ');
      const end = startsWord ? findClosing(src, i + mark.length, mark) : -1;
      if (end > i + mark.length) {
        flush();
        out.push({ t: double ? 'strong' : 'em', children: parseInline(src.slice(i + mark.length, end)) });
        i = end + mark.length;
        continue;
      }
    }

    if (c === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(src);
      if (m) {
        const children = parseInline(m[1]!);
        const href = safeHref(m[2]!);
        flush();
        if (href) out.push({ t: 'link', href, children });
        else out.push(...children); // adresse refusée : on garde le texte, pas le lien
        i += m[0].length;
        continue;
      }
    }

    text += c;
    i++;
  }
  flush();
  return out;
}

export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.text : inlineText(n.children))).join('');
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocs

const FENCE = /^ {0,3}(`{3,})\s*([\w-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const IMAGE = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)\s*$/;
const CALLOUT = /^\[!(TIP|NOTE|WARNING)\]\s*$/i;

const isBlank = (l: string) => l.trim() === '';

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  if (cells[0]!.trim() === '') cells.shift();
  if (cells.length && cells.at(-1)!.trim() === '') cells.pop();
  return cells.map((s) => s.trim());
}

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
};

/** Retire jusqu'à `n` espaces de tête. */
const dedent = (line: string, n: number) => line.replace(new RegExp(`^ {0,${n}}`), '');
const indentOf = (line: string) => line.search(/\S/);

/** Compteur d'ancres : deux titres identiques reçoivent `-2`, `-3`… pour que chaque lien du sommaire reste unique. */
class Anchors {
  private seen = new Map<string, number>();
  next(text: string): string {
    const base = slugify(text) || 'section';
    const n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  }
}

function parseBlocks(lines: string[], anchors: Anchors): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  const startsBlock = (line: string, next?: string) =>
    FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || IMAGE.test(line.trim()) ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('|'));

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}\`{${marker.length},}\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
      i++; // ligne de fermeture (ou fin du fichier)
      blocks.push({ t: 'code', lang: fence[2]!, text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(Math.max(heading[1]!.length, 2), 4) as 2 | 3 | 4; // le h1 est le titre de l'article
      const children = parseInline(heading[2]!);
      const text = inlineText(children);
      blocks.push({ t: 'heading', level, id: anchors.next(text), children, text });
      i++;
      continue;
    }

    if (HR.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(lines[i++]!.replace(/^ {0,3}> ?/, ''));
      const callout = CALLOUT.exec(inner[0]!.trim());
      if (callout) blocks.push({ t: 'callout', kind: callout[1]!.toLowerCase() as CalloutKind, children: parseBlocks(inner.slice(1), anchors) });
      else blocks.push({ t: 'quote', children: parseBlocks(inner, anchors) });
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const baseIndent = first[1]!.length;
      const ordered = /\d/.test(first[2]!);
      const sameList = (l: string) => {
        const m = LIST_ITEM.exec(l);
        return !!m && m[1]!.length === baseIndent && /\d/.test(m[2]!) === ordered;
      };
      const items: ListItem[] = [];
      while (i < lines.length && sameList(lines[i]!)) {
        const m = LIST_ITEM.exec(lines[i]!)!;
        const contentIndent = baseIndent + m[2]!.length + 1;
        const own: string[] = [m[3]!];
        const rest: string[] = [];
        i++;
        // Suite de l'élément : lignes plus indentées que le repère (sous-listes, paragraphes), lignes vides comprises.
        while (i < lines.length) {
          const l = lines[i]!;
          if (isBlank(l)) {
            let j = i;
            while (j < lines.length && isBlank(lines[j]!)) j++;
            if (j >= lines.length) { i = j; break; }
            if (indentOf(lines[j]!) > baseIndent) { rest.push(...lines.slice(i, j)); i = j; continue; }
            if (sameList(lines[j]!)) i = j; // liste aérée : l'élément suivant reste dans la même liste
            break;
          }
          if (indentOf(l) <= baseIndent) {
            // Même niveau ou moins : autre élément, autre bloc, ou ligne qui prolonge simplement le texte de l'élément.
            if (LIST_ITEM.test(l) || startsBlock(l) || rest.length > 0) break;
            own.push(l.trim());
            i++;
            continue;
          }
          const inner = dedent(l, contentIndent);
          if (rest.length === 0 && !startsBlock(inner)) own.push(inner.trim());
          else rest.push(inner);
          i++;
        }
        items.push({ children: parseInline(own.join(' ')), blocks: parseBlocks(rest, anchors) });
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes('|')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes('|')) {
        const cells = splitRow(lines[i++]!);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? '')));
      }
      blocks.push({ t: 'table', head: head.map(parseInline), rows, align: head.map((_, c) => align[c] ?? null) });
      continue;
    }

    const image = IMAGE.exec(line.trim());
    if (image) {
      const src = safeSrc(image[2]!);
      if (src) blocks.push({ t: 'image', src, alt: image[1]! });
      i++;
      continue;
    }

    // Paragraphe : jusqu'à une ligne vide ou le début d'un autre bloc. Les retours à la ligne simples valent une espace.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines[i]!, lines[i + 1])) para.push(lines[i++]!.trim());
    blocks.push({ t: 'paragraph', children: parseInline(para.join(' ')) });
  }
  return blocks;
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), new Anchors());
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture de l'arbre

/** Titres du corps de l'article (h2 à h4), dans l'ordre : sert au sommaire. */
export function headingsOf(blocks: Block[]): Heading[] {
  return blocks.flatMap((b) => (b.t === 'heading' ? [{ id: b.id, text: b.text, level: b.level }] : []));
}

/** Tout le texte d'un arbre, pour compter les mots. */
export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b): string => {
      switch (b.t) {
        case 'heading':
          return b.text;
        case 'paragraph':
          return inlineText(b.children);
        case 'list':
          return b.items.map((it) => `${inlineText(it.children)} ${blocksText(it.blocks)}`).join(' ');
        case 'quote':
        case 'callout':
          return blocksText(b.children);
        case 'table':
          return [...b.head, ...b.rows.flat()].map(inlineText).join(' ');
        case 'code':
        case 'image':
        case 'hr':
          return '';
      }
    })
    .join(' ');
}
