import { cleanText } from '../text.ts';
import { decodeText, looksBinary } from './decode.ts';
import { ExtractError } from './errors.ts';

/** Un fichier .txt ou .md : décodé et nettoyé. Un en-tête YAML (« --- … --- ») au début d'un fichier Markdown est retiré. */
export function extractPlain(bytes: Uint8Array): string {
  if (looksBinary(bytes)) throw new ExtractError('corrupt', 'le fichier n’est pas du texte');
  const text = cleanText(decodeText(bytes));
  const front = /^---\n[\s\S]{0,2000}?\n---\n/.exec(text);
  return front ? text.slice(front[0].length).trim() : text;
}

/** Le séparateur le plus fréquent de la première ligne : virgule, point-virgule, tabulation ou barre verticale. */
function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

/** Découpe un CSV (champs entre guillemets, guillemets doublés, retours à la ligne dans un champ). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * Un fichier .csv, en texte lisible : avec une ligne d'en-tête (que des mots, pas de nombre), chaque ligne devient « Colonne : valeur | Colonne : valeur » ;
 * sinon les cellules sont séparées par « | ». Une ligne par paragraphe, pour que le découpage ne coupe jamais une ligne en deux.
 */
export function extractCsv(bytes: Uint8Array, maxRows = 20_000): string {
  if (looksBinary(bytes)) throw new ExtractError('corrupt', 'le fichier n’est pas du texte');
  const text = decodeText(bytes).replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const rows = parseCsv(text, detectDelimiter(firstLine)).slice(0, maxRows + 1);
  if (rows.length === 0) return '';
  const header = rows[0]!.map((h) => cleanText(h));
  const hasHeader = rows.length > 1 && header.every((h) => h !== '' && !/^[\d\s.,€$%-]+$/.test(h));
  const body = hasHeader ? rows.slice(1) : rows;
  const lines = body.map((cells) => {
    const clean = cells.map((c) => cleanText(c).replace(/\n+/g, ' '));
    const parts = hasHeader ? clean.map((c, i) => (c ? `${header[i] || `Colonne ${i + 1}`} : ${c}` : '')) : clean;
    return parts.filter(Boolean).join(' | ');
  });
  return lines.filter(Boolean).join('\n\n');
}
