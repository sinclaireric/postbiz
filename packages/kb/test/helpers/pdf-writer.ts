/** Un PDF minimal fait à la main : polices standard (Helvetica, Helvetica-Bold), texte positionné ligne par ligne, tableau de références exact. Pour tester le lecteur. */

export interface PdfLine {
  text: string;
  x?: number;
  y: number;
  size?: number;
  bold?: boolean;
}

const latin1 = (s: string) => Buffer.from(s, 'latin1');
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function makePdf(pages: PdfLine[][]): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : latin1(body));
    return objects.length;
  };
  const catalog = add('');
  const tree = add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const lines of pages) {
    const content = lines.map((l) => `BT /${l.bold ? 'F2' : 'F1'} ${l.size ?? 12} Tf 1 0 0 1 ${l.x ?? 72} ${l.y} Tm (${escapeText(l.text)}) Tj ET`).join('\n');
    const stream = latin1(content);
    const contentId = add(Buffer.concat([latin1(`<< /Length ${stream.length} >>\nstream\n`), stream, latin1('\nendstream')]));
    pageIds.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalog - 1] = latin1(`<< /Type /Catalog /Pages ${tree} 0 R >>`);
  objects[tree - 1] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);

  const chunks: Buffer[] = [latin1('%PDF-1.4\n')];
  const offsets: number[] = [];
  let at = chunks[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(at);
    const part = Buffer.concat([latin1(`${i + 1} 0 obj\n`), body, latin1('\nendobj\n')]);
    chunks.push(part);
    at += part.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(latin1(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
