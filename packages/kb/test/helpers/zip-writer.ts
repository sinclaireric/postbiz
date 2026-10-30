import zlib from 'node:zlib';

export interface ZipFile {
  name: string;
  data: Buffer | string;
  /** `store` (0) ou `deflate` (8, par défaut). */
  method?: 'store' | 'deflate';
  /** Fausse la taille décompressée annoncée dans le répertoire central (pour tester les bombes). */
  declaredSize?: number;
  /** Pose le drapeau « chiffré ». */
  encrypted?: boolean;
}

/** Une archive ZIP minimale (sans ZIP64), pour fabriquer des fichiers de test. */
export function makeZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const method = f.method === 'store' ? 0 : 8;
    const body = method === 0 ? raw : zlib.deflateRawSync(raw);
    const name = Buffer.from(f.name);
    const crc = zlib.crc32(raw);
    const flags = f.encrypted ? 1 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.declaredSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

/** Un document Word minimal : le XML du corps, et si besoin celui des styles. */
export function makeDocx(bodyXml: string, stylesXml?: string): Buffer {
  const files: ZipFile[] = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>` },
  ];
  if (stylesXml) files.push({ name: 'word/styles.xml', data: `<?xml version="1.0"?><w:styles ${NS}>${stylesXml}</w:styles>` });
  return makeZip(files);
}

/** Un paragraphe Word : texte, style éventuel, liste, texte masqué. */
export const para = (text: string, o: { style?: string; list?: boolean; hidden?: boolean; outline?: number } = {}): string =>
  `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}${o.outline !== undefined ? `<w:outlineLvl w:val="${o.outline}"/>` : ''}</w:pPr><w:r>${o.hidden ? '<w:rPr><w:vanish/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
