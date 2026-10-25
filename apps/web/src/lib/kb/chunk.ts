import { KB } from './types';

/** Un passage : son texte, la section où il se trouve, et le texte qu'on vectorise (le titre de la fiche et la section donnent le contexte). */
export interface Chunk {
  content: string;
  heading: string | null;
  embedText: string;
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
/** Une ligne seule qui se termine par « : » (« Livraison : ») ouvre une section. */
const LABEL = /^([^\n:]{2,60}):\s*$/;
const SENTENCE_END = /(?<=[.!?…。！？])\s+/u;

interface Block {
  heading: string | null;
  text: string;
}

/** Paragraphes du texte, chacun avec la section qui le précède. Les intertitres ne sont pas des paragraphes. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let heading: string | null = null;
  for (const raw of text.split(/\n{2,}/)) {
    const lines = raw.split('\n').map((l) => l.trimEnd());
    while (lines.length > 0) {
      const first = lines[0]!.trim();
      const m = HEADING.exec(first) ?? LABEL.exec(first);
      if (!m || first === '') break;
      heading = m[1]!.trim();
      lines.shift();
    }
    const body = lines.join('\n').trim();
    if (body) out.push({ heading, text: body });
  }
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

/**
 * Découpe une fiche en passages d'environ `KB.chunkChars` signes : aux paragraphes, sans mélanger deux sections quand le passage en cours est déjà
 * assez long, et avec reprise de la fin du morceau précédent quand un paragraphe doit être coupé. Un texte court reste en un seul passage.
 * Texte vide : aucun passage.
 */
export function chunkKnowledge(title: string, content: string): Chunk[] {
  const text = content.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  interface Section {
    heading: string | null;
    parts: string[];
    size: number;
  }
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
      const sectionChanged = current !== null && current.heading !== block.heading && current.size >= KB.chunkMinChars;
      if (current && (sectionChanged || current.size + 2 + size(piece) > KB.chunkChars)) flush();
      if (!current) current = { heading: block.heading, parts: [], size: 0 };
      current.parts.push(piece);
      current.size += size(piece) + (current.parts.length > 1 ? 2 : 0);
    }
  }
  flush();

  // Un dernier passage trop court est rattaché au précédent quand ils tiennent ensemble.
  const last = chunks[chunks.length - 1];
  const before = chunks[chunks.length - 2];
  if (last && before && last.size < KB.chunkMinChars && before.size + 2 + last.size <= KB.chunkChars * 1.25) {
    before.parts.push(...last.parts);
    before.size += 2 + last.size;
    chunks.pop();
  }

  return chunks.slice(0, KB.maxChunksPerItem).map((c) => {
    const content = c.parts.join('\n\n');
    const context = [title.trim(), c.heading].filter(Boolean).join(' > ');
    return { content, heading: c.heading, embedText: context ? `${context}\n${content}` : content };
  });
}
