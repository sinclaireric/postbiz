import { Parser } from 'htmlparser2';
import { SOURCE_LIMITS } from '../constants.ts';
import { cleanText } from '../text.ts';
import { ExtractError } from './errors.ts';
import { ZipArchive } from './zip.ts';

// Un document Word (.docx) : une archive ZIP dont `word/document.xml` contient le texte. On en tire des paragraphes, des intertitres (« # »), des listes (« - ») et des
// tableaux (une ligne par rangée, cellules séparées par « | »). Le texte masqué (w:vanish) et le texte supprimé en suivi des modifications (w:delText) sont ignorés.

const HEADING_STYLE = /^(?:heading|titre)\s*(\d)$/i;

/** Les styles du document : identifiant → niveau d'intertitre (1 à 6), d'après `word/styles.xml`. « Title » compte comme un intertitre de niveau 1. */
function headingStyles(xml: string | null): Map<string, number> {
  const levels = new Map<string, number>();
  if (!xml) return levels;
  let id: string | null = null;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'w:style') id = attrs['w:styleId'] ?? null;
        else if (name === 'w:name' && id) {
          const value = (attrs['w:val'] ?? '').trim();
          const m = HEADING_STYLE.exec(value);
          if (m) levels.set(id, Math.min(6, Math.max(1, Number(m[1]))));
          else if (/^title$/i.test(value)) levels.set(id, 1);
        }
      },
      onclosetag(name) {
        if (name === 'w:style') id = null;
      },
    },
    { xmlMode: true },
  );
  parser.write(xml);
  parser.end();
  return levels;
}

/** Le texte d'un document Word, ou une erreur `corrupt` (pas un .docx), `encrypted` (protégé par mot de passe) ou `too_large`. */
export function extractDocx(bytes: Uint8Array, maxChars: number = SOURCE_LIMITS.textChars): { text: string; truncated: boolean } {
  let zip: ZipArchive;
  try {
    zip = new ZipArchive(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    throw new ExtractError('corrupt', 'archive illisible');
  }
  // Un .docx protégé par mot de passe est un fichier OLE (pas un ZIP) : l'ouverture a déjà échoué. Un ZIP sans `word/document.xml` n'est pas un document Word.
  const documentXml = zip.read('word/document.xml');
  if (!documentXml) throw new ExtractError('corrupt', 'ce n’est pas un document Word');
  const styles = headingStyles(zip.read('word/styles.xml')?.toString('utf8') ?? null);

  const blocks: string[] = [];
  let length = 0;
  let truncated = false;

  // État de lecture.
  let paragraph = '';
  let style = '';
  let listItem = false;
  let outline: number | null = null;
  let inText = false;
  let hiddenRun = false;
  let inRunProps = false;
  let fallbackDepth = 0;
  let tableDepth = 0;
  /** Paragraphes ouverts l'un dans l'autre (une zone de texte dans un paragraphe) : le texte de l'extérieur attend la fin de l'intérieur. */
  const outer: string[] = [];
  let cells: string[] = [];
  let cell = '';
  let inCell = false;

  const finishParagraph = () => {
    const raw = cleanText(paragraph.replace(/\t/g, ' '));
    paragraph = '';
    const level = outline !== null ? outline : styles.get(style) ?? null;
    const wasList = listItem;
    style = '';
    listItem = false;
    outline = null;
    if (!raw) return;
    if (inCell) {
      cell += (cell ? ' ' : '') + raw;
      return;
    }
    const block = level !== null && raw.length <= 200 ? `${'#'.repeat(level)} ${raw}` : wasList ? `- ${raw}` : raw;
    push(block);
  };
  const push = (block: string) => {
    if (truncated) return;
    if (length + block.length > maxChars) {
      truncated = true;
      return;
    }
    blocks.push(block);
    length += block.length + 2;
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'mc:Fallback') fallbackDepth++;
        if (fallbackDepth > 0) return;
        switch (name) {
          case 'w:p':
            outer.push(paragraph);
            paragraph = '';
            break;
          case 'w:pStyle':
            style = attrs['w:val'] ?? '';
            break;
          case 'w:numPr':
            listItem = true;
            break;
          case 'w:outlineLvl': {
            const n = Number(attrs['w:val']);
            if (Number.isInteger(n) && n >= 0 && n <= 5) outline = n + 1;
            break;
          }
          case 'w:r':
            hiddenRun = false;
            break;
          case 'w:rPr':
            inRunProps = true;
            break;
          case 'w:vanish':
            if (inRunProps && attrs['w:val'] !== '0' && attrs['w:val'] !== 'false') hiddenRun = true;
            break;
          case 'w:t':
            inText = true;
            break;
          case 'w:tab':
            paragraph += '\t';
            break;
          case 'w:br':
          case 'w:cr':
            paragraph += ' ';
            break;
          case 'w:noBreakHyphen':
            paragraph += '-';
            break;
          case 'w:tbl':
            tableDepth++;
            break;
          // Seules les rangées et cellules du tableau de premier niveau sont structurées ; un tableau dans une cellule en fait partie, comme du texte.
          case 'w:tr':
            if (tableDepth === 1) cells = [];
            break;
          case 'w:tc':
            if (tableDepth === 1) {
              inCell = true;
              cell = '';
            }
            break;
        }
      },
      ontext(data) {
        if (inText && fallbackDepth === 0 && !hiddenRun) paragraph += data;
      },
      onclosetag(name) {
        if (name === 'mc:Fallback') {
          fallbackDepth = Math.max(0, fallbackDepth - 1);
          return;
        }
        if (fallbackDepth > 0) return;
        switch (name) {
          case 'w:t':
            inText = false;
            break;
          case 'w:rPr':
            inRunProps = false;
            break;
          case 'w:p':
            finishParagraph();
            paragraph = outer.pop() ?? '';
            break;
          case 'w:tc':
            if (tableDepth === 1) {
              cells.push(cleanText(cell));
              inCell = false;
              cell = '';
            }
            break;
          case 'w:tr': {
            if (tableDepth !== 1) break;
            const row = cells.filter(Boolean).join(' | ');
            if (row) push(row);
            cells = [];
            break;
          }
          case 'w:tbl':
            tableDepth = Math.max(0, tableDepth - 1);
            break;
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(documentXml.toString('utf8'));
  parser.end();
  return { text: blocks.join('\n\n'), truncated };
}
