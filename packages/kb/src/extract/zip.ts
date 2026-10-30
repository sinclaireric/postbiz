import zlib from 'node:zlib';
import { ExtractError } from './errors.ts';

// Un lecteur d'archives ZIP, juste assez pour ouvrir un .docx : on lit quelques fichiers de l'archive, jamais tout. Plafonds anti-« bombe » : nombre d'entrées,
// taille déclarée de chaque entrée avant de la décompresser, taille réelle plafonnée par zlib, total lu.

export interface ZipLimits {
  maxEntries: number;
  /** Taille décompressée maximale d'une entrée. */
  maxEntryBytes: number;
  /** Taille décompressée maximale de tout ce qu'on lit dans l'archive. */
  maxTotalBytes: number;
}
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 5_000, maxEntryBytes: 40 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024 };

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export class ZipArchive {
  private readonly entries = new Map<string, Entry>();
  private total = 0;

  constructor(private readonly buf: Buffer, private readonly limits: ZipLimits = DEFAULT_ZIP_LIMITS) {
    this.index();
  }

  private index(): void {
    const { buf } = this;
    // Fin du répertoire central : dans les 64 Ko + 22 octets de la fin du fichier.
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ExtractError('corrupt', 'archive ZIP illisible');
    const count = buf.readUInt16LE(eocd + 10);
    const size = buf.readUInt32LE(eocd + 12);
    const start = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || start === 0xffffffff || size === 0xffffffff) throw new ExtractError('corrupt', 'ZIP64 non pris en charge');
    if (count > this.limits.maxEntries) throw new ExtractError('too_large', 'trop de fichiers dans l’archive');
    if (start + size > buf.length) throw new ExtractError('corrupt', 'répertoire de l’archive hors du fichier');

    let p = start;
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ExtractError('corrupt', 'répertoire de l’archive abîmé');
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const compressedSize = buf.readUInt32LE(p + 20);
      const entrySize = buf.readUInt32LE(p + 24);
      const nameLength = buf.readUInt16LE(p + 28);
      const extraLength = buf.readUInt16LE(p + 30);
      const commentLength = buf.readUInt16LE(p + 32);
      const offset = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
      if (flags & 0x1) throw new ExtractError('encrypted', 'archive chiffrée');
      this.entries.set(name, { name, method, compressedSize, size: entrySize, offset });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Le contenu d'un fichier de l'archive, ou null s'il n'y est pas. */
  read(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const { buf, limits } = this;
    if (entry.size > limits.maxEntryBytes || this.total + entry.size > limits.maxTotalBytes) throw new ExtractError('too_large', 'fichier de l’archive trop volumineux une fois décompressé');
    const at = entry.offset;
    if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new ExtractError('corrupt', 'entrée d’archive abîmée');
    const data = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const end = data + entry.compressedSize;
    if (end > buf.length) throw new ExtractError('corrupt', 'entrée d’archive tronquée');
    const raw = buf.subarray(data, end);
    let out: Buffer;
    if (entry.method === 0) out = raw;
    else if (entry.method === 8) {
      try {
        // Le plafond vaut pour la taille réelle, quelle que soit celle que l'archive déclare.
        out = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(limits.maxEntryBytes, limits.maxTotalBytes - this.total) });
      } catch (error) {
        if (error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new ExtractError('too_large', 'fichier de l’archive trop volumineux une fois décompressé');
        throw new ExtractError('corrupt', 'entrée d’archive illisible');
      }
    } else throw new ExtractError('corrupt', `méthode de compression ${entry.method} non prise en charge`);
    this.total += out.length;
    return out;
  }
}
