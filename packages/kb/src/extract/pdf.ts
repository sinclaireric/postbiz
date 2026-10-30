import { SOURCE_LIMITS } from '../constants.ts';
import { cleanText } from '../text.ts';
import { ExtractError } from './errors.ts';

// Un PDF avec couche de texte : on lit les fragments de texte avec leur position et leur taille de police (pdf.js, par `unpdf`), puis on refait les lignes, les
// paragraphes et les intertitres (police nettement plus grande que le texte courant). Les en-têtes et pieds de page qui se répètent sont retirés.
// Pas de reconnaissance de caractères : un PDF qui n'est qu'une suite d'images (scan) n'a pas de texte à lire, et le dit (`no_text`).

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[]; styles: Record<string, { fontFamily?: string } | undefined> }>;
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  cleanup(): Promise<void>;
}
interface TextItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL: boolean;
}
const isTextItem = (item: unknown): item is TextItem => typeof item === 'object' && item !== null && typeof (item as TextItem).str === 'string' && Array.isArray((item as TextItem).transform);

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

const MAX_PAGES = 400;
const BULLET = /^([-•*▪◦●–—]|\d{1,3}[.)])\s+\S/;
const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:\/|sur|of)\s*\d{1,4})?$/i;
const round = (n: number) => Math.round(n * 2) / 2;

/** Les lignes d'une page : les fragments se suivent dans l'ordre du flux, `hasEOL` marque la fin d'une ligne. */
function linesOf(content: { items: unknown[]; styles: Record<string, { fontFamily?: string } | undefined> }): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  const close = () => {
    if (current && current.text.trim()) lines.push({ ...current, text: current.text.replace(/\s+/g, ' ').trim() });
    current = null;
  };
  for (const item of content.items) {
    if (!isTextItem(item)) continue;
    const size = Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0);
    const visible = item.str.trim() !== '';
    if (!current) {
      if (!visible) continue;
      current = { text: '', x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, size: 0, width: 0 };
    }
    current.text += item.str;
    if (visible) {
      current.size = Math.max(current.size, size);
      current.width = (item.transform[4] ?? 0) + item.width - current.x;
    }
    if (item.hasEOL) close();
  }
  close();
  return lines;
}

/** Assemble les lignes d'une page en paragraphes et intertitres. */
function pageBlocks(lines: Line[], body: number, headingLevel: (size: number) => number | null): string[] {
  const blocks: string[] = [];
  let para = '';
  let prev: Line | null = null;
  /** Le dernier intertitre posé : sa place dans `blocks`, sa taille et la hauteur de sa dernière ligne. */
  let lastHeading: { index: number; size: number; y: number } | null = null;
  const flush = () => {
    if (para.trim()) blocks.push(para.trim());
    para = '';
  };
  for (const line of lines) {
    const level = line.text.length <= 140 && !/[.;,]$/.test(line.text) ? headingLevel(line.size) : null;
    if (level !== null) {
      // Un titre trop long pour une ligne passe à la suivante : deux lignes de même taille, au pas d'une même phrase, ne font qu'un intertitre.
      const below = lastHeading ? lastHeading.y - line.y : 0;
      if (lastHeading && !para.trim() && blocks.length - 1 === lastHeading.index && round(line.size) === lastHeading.size && below > 0 && below <= line.size * 1.5) {
        blocks[lastHeading.index] += ` ${line.text}`;
        lastHeading.y = line.y;
        prev = line;
        continue;
      }
      flush();
      blocks.push(`${'#'.repeat(level)} ${line.text}`);
      lastHeading = { index: blocks.length - 1, size: round(line.size), y: line.y };
      prev = line;
      continue;
    }
    const gap = prev ? prev.y - line.y : 0;
    // Nouveau paragraphe : interligne plus grand que d'habitude, retour en haut (autre colonne), puce, ou fin de phrase avant un retrait.
    const startsNew =
      !para ||
      gap > body * 1.6 ||
      gap < -body * 2 ||
      BULLET.test(line.text) ||
      (prev !== null && line.x - prev.x > body * 1.2 && /[.!?:]$/.test(para.trimEnd()));
    if (startsNew) {
      flush();
      para = line.text;
    } else if (/\p{L}-$/u.test(para) && /^\p{Ll}/u.test(line.text)) para = para.slice(0, -1) + line.text; // mot coupé en fin de ligne
    else para += ` ${line.text}`;
    prev = line;
  }
  flush();
  return blocks;
}

/** Texte d'un PDF, une page après l'autre (séparées par U+000C), avec des intertitres « # ». */
export async function extractPdf(
  bytes: Uint8Array,
  o: { maxChars?: number; maxPages?: number } = {},
): Promise<{ text: string; pages: number; truncated: boolean }> {
  const maxChars = o.maxChars ?? SOURCE_LIMITS.textChars;
  const maxPages = Math.min(o.maxPages ?? MAX_PAGES, MAX_PAGES);
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    // Quelques générateurs laissent des octets avant l'en-tête : pdf.js les tolère jusqu'à 1 Ko.
    const head = Buffer.from(bytes.subarray(0, 1_024)).toString('latin1');
    if (!head.includes('%PDF-')) throw new ExtractError('corrupt', 'ce n’est pas un PDF');
  }
  const { getDocumentProxy } = await import('unpdf');
  let pdf: PdfDocument;
  try {
    pdf = (await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true, useSystemFonts: false, verbosity: 0 })) as unknown as PdfDocument;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name ?? '';
    if (name === 'PasswordException') throw new ExtractError('encrypted', 'PDF protégé par un mot de passe');
    throw new ExtractError('corrupt', 'PDF illisible');
  }

  try {
    const total = pdf.numPages;
    const read = Math.min(total, maxPages);
    const perPage: Line[][] = [];
    for (let n = 1; n <= read; n++) {
      const page = await pdf.getPage(n);
      try {
        perPage.push(linesOf(await page.getTextContent()));
      } finally {
        page.cleanup();
      }
    }

    // En-têtes et pieds de page : une même ligne (chiffres mis à part) dans la bande haute ou basse d'au moins 40 % des pages (3 au moins).
    const norm = (t: string) => t.toLowerCase().replace(/\d+/g, '#').trim();
    const inBand = (line: Line, lines: Line[]) => {
      // Une page de moins de trois lignes, ou presque tassée, n'a pas de « haut » ni de « bas » : rien n'y est un en-tête.
      if (lines.length < 3) return false;
      const ys = lines.map((l) => l.y);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      if (hi - lo < 100) return false;
      const band = (hi - lo) * 0.1;
      return line.y >= hi - band || line.y <= lo + band;
    };
    const repeated = new Set<string>();
    if (read >= 3) {
      const counts = new Map<string, number>();
      for (const lines of perPage) {
        const seen = new Set<string>();
        for (const l of lines) if (inBand(l, lines)) seen.add(norm(l.text));
        for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      for (const [t, c] of counts) if (c >= Math.max(3, Math.ceil(read * 0.4))) repeated.add(t);
    }
    const kept = perPage.map((lines) => lines.filter((l) => !(inBand(l, lines) && (repeated.has(norm(l.text)) || PAGE_NUMBER.test(l.text)))));

    // Taille du texte courant : la plus fréquente (en signes) ; intertitres : les tailles nettement plus grandes, la plus grande en premier.
    const bySize = new Map<number, number>();
    for (const lines of kept) for (const l of lines) bySize.set(round(l.size), (bySize.get(round(l.size)) ?? 0) + l.text.length);
    const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const heading = [...bySize.entries()].filter(([size, chars]) => body > 0 && size >= body * 1.2 && chars <= 4_000).map(([size]) => size).sort((a, b) => b - a);
    const headingLevel = (size: number): number | null => {
      const i = heading.indexOf(round(size));
      return i < 0 ? null : Math.min(i + 1, 3);
    };

    const pages: string[] = [];
    let length = 0;
    let truncated = total > read;
    for (const lines of kept) {
      const text = pageBlocks(lines, body || 10, headingLevel).join('\n\n');
      if (length + text.length > maxChars) {
        truncated = true;
        pages.push(text.slice(0, Math.max(0, maxChars - length)));
        break;
      }
      pages.push(text);
      length += text.length + 1;
    }
    const text = pages.map((p) => cleanText(p)).join('\f');
    const visible = text.replace(/[\s\f]/g, '').length;
    // Un PDF fait d'images (scan) : presque rien à lire. La densité se mesure sur les pages gardées (un texte coupé au plafond n'est pas un scan).
    if (visible < 40 || visible / Math.max(1, pages.length) < 25) throw new ExtractError('no_text', 'ce PDF n’a pas de texte (scan ?)');
    return { text, pages: total, truncated };
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    throw new ExtractError('corrupt', 'PDF illisible');
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}
