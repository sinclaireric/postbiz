import { KB } from './constants.ts';

/** Un passage : son texte, la section où il se trouve, et le texte qu'on vectorise (le titre de la fiche et la section donnent le contexte). */
export interface Chunk {
  content: string;
  heading: string | null;
  embedText: string;
  /** Pages (d'un PDF) que couvre le passage, de la première à la dernière ; absent pour un texte sans pages. */
  pages?: [number, number];
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
/** Une ligne seule qui se termine par « : » (« Livraison : ») ouvre une section ; pas un élément de liste (« - Les pièces suivantes : »), qui annonce une sous-liste. */
const LABEL = /^(?![-*•–—]\s|\d{1,3}[.)]\s)([^\n:]{2,60}):\s*$/u;
const SENTENCE_END = /(?<=[.!?…。！？])\s+/u;

interface Block {
  heading: string | null;
  text: string;
  /** Numéro de la page (à partir de 1) quand le texte est paginé (sauts de page U+000C), sinon null. */
  page: number | null;
}

/** Paragraphes du texte, chacun avec la section qui le précède. Les intertitres ne sont pas des paragraphes. Un saut de page (U+000C) ouvre la page suivante. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let heading: string | null = null;
  const pages = text.split('\f');
  const paged = pages.length > 1;
  pages.forEach((pageText, index) => {
    for (const raw of pageText.split(/\n{2,}/)) {
      const lines = raw.split('\n').map((l) => l.trimEnd());
      while (lines.length > 0) {
        const first = lines[0]!.trim();
        const m = HEADING.exec(first) ?? LABEL.exec(first);
        if (!m || first === '') break;
        heading = m[1]!.trim();
        lines.shift();
      }
      const body = lines.join('\n').trim();
      if (body) out.push({ heading, text: body, page: paged ? index + 1 : null });
    }
  });
  return out;
}

/** Coupe un texte trop long en morceaux d'au plus `max` signes, aux phrases puis aux mots, en reprenant la fin du morceau précédent. */
function splitLong(text: string, max: number, overlap: number): string[] {
  const units: string[] = [];
  for (const sentence of text.split(SENTENCE_END)) {
    if ([...sentence].length <= max) {
      units.push(sentence);
      continue;
    }
    // Une phrase démesurée : par mots, puis, pour un mot démesuré (une adresse), par signes.
    let line = '';
    for (const word of sentence.split(/\s+/)) {
      if ([...word].length > max) {
        if (line) units.push(line);
        line = '';
        const chars = [...word];
        for (let i = 0; i < chars.length; i += max) units.push(chars.slice(i, i + max).join(''));
      } else if ([...line].length + 1 + [...word].length > max) {
        units.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) units.push(line);
  }

  const pieces: string[] = [];
  let current = '';
  for (const unit of units) {
    const joined = current ? `${current} ${unit}` : unit;
    if ([...joined].length <= max) {
      current = joined;
      continue;
    }
    if (current) pieces.push(current);
    // Reprise de la fin du morceau précédent, coupée à un mot pour ne pas commencer au milieu. Sans espace dans cette fin (un mot démesuré coupé de force), pas de reprise.
    const window = current && overlap > 0 ? [...current].slice(-overlap).join('') : '';
    const cut = /^\S*\s/.exec(window);
    const tail = cut ? window.slice(cut[0].length) : '';
    current = tail && [...`${tail} ${unit}`].length <= max ? `${tail} ${unit}` : unit;
  }
  if (current) pieces.push(current);
  return pieces;
}

const size = (s: string) => [...s].length;

interface Section {
  /** La section par laquelle le passage commence : c'est son repère, et le contexte de son texte vectorisé. */
  heading: string | null;
  /** La section du dernier paragraphe : un paragraphe d'une autre section est précédé du titre de celle-ci (voir `lead`). */
  last: string | null;
  parts: string[];
  size: number;
  pages: [number, number] | null;
}

const widen = (pages: [number, number] | null, page: number | null): [number, number] | null =>
  page === null ? pages : pages ? [Math.min(pages[0], page), Math.max(pages[1], page)] : [page, page];

/** Tous les passages d'un texte, sans plafond. */
function chunkAll(title: string, content: string): Chunk[] {
  const text = content.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const chunks: Section[] = [];
  let current = null as Section | null;
  const flush = () => {
    if (current && current.parts.length > 0) chunks.push(current);
    current = null;
  };

  for (const block of blocks(text)) {
    // Un paragraphe plus long qu'un passage est d'abord coupé.
    const pieces = size(block.text) > KB.chunkChars ? splitLong(block.text, KB.chunkChars, KB.overlapChars) : [block.text];
    for (const piece of pieces) {
      // De petites sections voisines tiennent dans un même passage : le titre de chacune reste alors dans le texte (le passage n'a qu'un repère, celui de la première).
      const lead = (into: Section | null) => (into && block.heading && block.heading !== into.last ? `${block.heading}\n` : '');
      const sectionChanged = current !== null && current.heading !== block.heading && current.size >= KB.chunkMinChars;
      if (current && (sectionChanged || current.size + 2 + size(lead(current) + piece) > KB.chunkChars)) flush();
      if (!current) current = { heading: block.heading, last: block.heading, parts: [], size: 0, pages: null };
      const text = `${lead(current)}${piece}`;
      current.parts.push(text);
      current.size += size(text) + (current.parts.length > 1 ? 2 : 0);
      current.last = block.heading;
      current.pages = widen(current.pages, block.page);
    }
  }
  flush();

  // Un dernier passage trop court est rattaché au précédent quand ils tiennent ensemble.
  const last = chunks[chunks.length - 1];
  const before = chunks[chunks.length - 2];
  const lead = last && before && last.heading && last.heading !== before.last ? `${last.heading}\n` : '';
  if (last && before && last.size < KB.chunkMinChars && before.size + 2 + size(lead) + last.size <= KB.chunkChars * 1.25) {
    before.parts.push(`${lead}${last.parts[0]}`, ...last.parts.slice(1));
    before.size += 2 + size(lead) + last.size;
    before.last = last.last;
    if (last.pages) before.pages = widen(widen(before.pages, last.pages[0]), last.pages[1]);
    chunks.pop();
  }

  return chunks.map((c) => {
    const body = c.parts.join('\n\n');
    const context = [title.trim(), c.heading].filter(Boolean).join(' > ');
    return { content: body, heading: c.heading, embedText: context ? `${context}\n${body}` : body, ...(c.pages ? { pages: c.pages } : {}) };
  });
}

/**
 * Découpe un texte en passages d'environ `KB.chunkChars` signes : aux paragraphes, sans mélanger deux sections quand le passage en cours est déjà
 * assez long, et avec reprise de la fin du morceau précédent quand un paragraphe doit être coupé. Un texte court reste en un seul passage.
 * Texte vide : aucun passage. Au plus `maxChunks` passages ; `truncated` dit si le texte en aurait donné davantage.
 */
export function chunkSource(title: string, content: string, maxChunks: number): { chunks: Chunk[]; truncated: boolean } {
  const all = chunkAll(title, content);
  return { chunks: all.slice(0, maxChunks), truncated: all.length > maxChunks };
}

/** Une fiche de texte : au plus `KB.maxChunksPerItem` passages. */
export function chunkKnowledge(title: string, content: string): Chunk[] {
  return chunkSource(title, content, KB.maxChunksPerItem).chunks;
}
