import { FILE_TYPES, SOURCE_LIMITS, fileExtension, type FileExtension } from '../constants.ts';
import { cleanText } from '../text.ts';
import { decodeText, looksBinary, sniffHtmlCharset } from './decode.ts';
import { extractDocx } from './docx.ts';
import { ExtractError, type ExtractedDocument } from './errors.ts';
import { extractHtml } from './html.ts';
import { extractPdf } from './pdf.ts';
import { extractCsv, extractPlain } from './plain.ts';

export * from './errors.ts';
export * from './decode.ts';
export { extractHtml, businessFacts, type HtmlPage } from './html.ts';
export { extractDocx } from './docx.ts';
export { extractPdf } from './pdf.ts';
export { extractPlain, extractCsv, parseCsv } from './plain.ts';
export { ZipArchive, DEFAULT_ZIP_LIMITS } from './zip.ts';

/** Coupe un texte trop long à la limite d'un document, à la fin d'un paragraphe. */
function capText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf('\n\n');
  return { text: at > max * 0.8 ? cut.slice(0, at) : cut, truncated: true };
}

/**
 * Lit un fichier envoyé par l'utilisateur et en tire le texte. Le type vient de l'extension (pas du type MIME annoncé), puis le contenu est vérifié : un faux .pdf
 * ou un faux .docx est refusé (`corrupt`). Erreurs : `unsupported_type`, `too_large`, `corrupt`, `encrypted` (mot de passe), `no_text` (scan, ou fichier vide).
 */
export async function extractFile(bytes: Uint8Array, name: string): Promise<ExtractedDocument> {
  const ext: FileExtension | null = fileExtension(name);
  if (!ext) throw new ExtractError('unsupported_type', `type de fichier non pris en charge : ${name}`);
  if (bytes.length > SOURCE_LIMITS.fileBytes) throw new ExtractError('too_large', 'fichier trop volumineux');
  if (bytes.length === 0) throw new ExtractError('no_text', 'fichier vide');

  let raw: string;
  let pages: number | undefined;
  let truncated = false;
  switch (FILE_TYPES[ext]) {
    case FILE_TYPES.pdf: {
      const pdf = await extractPdf(bytes);
      raw = pdf.text;
      pages = pdf.pages;
      truncated = pdf.truncated;
      break;
    }
    case FILE_TYPES.docx: {
      const docx = extractDocx(bytes);
      raw = docx.text;
      truncated = docx.truncated;
      break;
    }
    case FILE_TYPES.csv:
      raw = extractCsv(bytes);
      break;
    case FILE_TYPES.html: {
      if (looksBinary(bytes)) throw new ExtractError('corrupt', 'le fichier n’est pas du texte');
      raw = extractHtml(decodeText(bytes, sniffHtmlCharset(bytes)), { keepFooter: true }).text;
      break;
    }
    default:
      raw = extractPlain(bytes);
  }

  // Les pages d'un PDF sont séparées par U+000C ; le reste est nettoyé tel quel.
  const cleaned = pages !== undefined ? raw : cleanText(raw);
  const capped = capText(cleaned, SOURCE_LIMITS.textChars);
  if (capped.text.replace(/[\s\f]/g, '').length < 20) throw new ExtractError('no_text', 'aucun texte dans le fichier');
  return { text: capped.text, ...(pages !== undefined ? { pages } : {}), truncated: truncated || capped.truncated };
}
