import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash.ts';
import { cleanText, previewOf, titleFromFileName, truncate } from '../src/text.ts';

describe('cleanText', () => {
  it('uniformise les fins de ligne, réduit les espaces et les lignes vides, normalise en NFC', () => {
    expect(cleanText('a\r\nb\rc\n\n\n\nd  \t e \n  f')).toBe('a\nb\nc\n\nd e\nf');
    expect(cleanText('e\u0301')).toBe('é'); // e + accent combinant → é
    expect(cleanText('  \n  ')).toBe('');
  });

  it('retire les caractères invisibles qui cachent des consignes (étiquettes Unicode, bidirectionnels, largeur nulle) mais garde les sauts de page et les émojis composés', () => {
    expect(cleanText('Bon\u200Bjour \u202Emonde\u202C \u2066x\u2069 \uFEFFfin\u00AD')).toBe('Bonjour monde x fin');
    expect(cleanText(`Salut${String.fromCodePoint(0xe0049, 0xe0047, 0xe004e, 0xe004f, 0xe0052, 0xe0045)} tout le monde`)).toBe('Salut tout le monde');
    expect(cleanText(`a${String.fromCodePoint(0xe0100)}b`)).toBe('ab');
    expect(cleanText('page 1\fpage 2')).toBe('page 1\fpage 2');
    expect(cleanText('👩\u200D💻 et \u200Cpersan')).toContain('👩\u200D💻');
    expect(cleanText('a\u0000b\u0007c\u007Fd\u009Fe')).toBe('abcde');
  });

  it('ramène les espaces de toute largeur à l’espace simple', () => {
    expect(cleanText('a\u00A0b\u202Fc\u2009d\u3000e')).toBe('a b c d e');
  });
});

describe('truncate, previewOf, titleFromFileName', () => {
  it('truncate coupe aux signes (pas aux octets), avec une ellipse', () => {
    expect(truncate('court', 10)).toBe('court');
    expect(truncate('0123456789', 5)).toBe('0123…');
    expect(truncate('👩\u200D💻abc'.repeat(4), 5).endsWith('…')).toBe(true);
    expect(truncate('abc ', 3)).toBe('ab…');
  });

  it('previewOf : une ligne, sans marques d’intertitre ni de puce, coupée', () => {
    expect(previewOf('# Livraison\n\n- offerte dès 60 euros\n- en Belgique\n\fPage 2 ici')).toBe('Livraison offerte dès 60 euros en Belgique Page 2 ici');
    expect(previewOf('x'.repeat(1_000), 50)).toHaveLength(50);
    expect(previewOf('')).toBe('');
  });

  it('titleFromFileName : sans dossier, sans extension, sans soulignés, au plus 120 signes', () => {
    expect(titleFromFileName('Catalogue_2026_été.PDF')).toBe('Catalogue 2026 été');
    expect(titleFromFileName('C:\\docs\\conditions.docx')).toBe('conditions');
    expect(titleFromFileName('/tmp/a/b/notes.md')).toBe('notes');
    expect(titleFromFileName('.pdf')).toBe('.pdf');
    expect(titleFromFileName('x'.repeat(300) + '.txt')).toHaveLength(120);
    expect(titleFromFileName('   ')).toBe('Document');
  });
});

describe('sha256Hex', () => {
  it('une empreinte stable, en hexadécimal', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(sha256Hex('abc'));
    expect(sha256Hex('')).toMatch(/^e3b0c442/);
  });
});

describe('la partie du paquet qui sert au navigateur reste libre de Node', () => {
  it.each(['src/index.ts', 'src/constants.ts', 'src/types.ts', 'src/text.ts', 'src/chunk.ts'])('%s n’importe rien de « node: » ni des lecteurs', (file) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/from\s+['"](htmlparser2|unpdf|openai)['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\/(hash|embed|net|extract|ingest)/);
  });
});
