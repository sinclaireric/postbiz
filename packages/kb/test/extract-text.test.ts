import { describe, expect, it } from 'vitest';
import { decodeText, looksBinary, sniffHtmlCharset } from '../src/extract/decode.ts';
import { ExtractError } from '../src/extract/errors.ts';
import { extractCsv, extractPlain, parseCsv } from '../src/extract/plain.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'aucune erreur';
  } catch (e) {
    return e instanceof ExtractError ? e.code : `autre : ${(e as Error).message}`;
  }
};

describe('decodeText', () => {
  const text = 'Éléphant à côté : 12 € — « ok »';
  it('lit UTF-8, avec ou sans BOM, et UTF-16 avec BOM', () => {
    expect(decodeText(Buffer.from(text, 'utf8'))).toBe(text);
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]))).toBe(text);
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))).toBe(text);
    const be = Buffer.from(text, 'utf16le').swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(text);
  });

  it('lit du Windows-1252 quand ce n’est pas de l’UTF-8 valide, ou quand l’en-tête l’annonce', () => {
    const latin = Buffer.from('Café à 5 € — « oui »', 'latin1'); // « € » et « — » n'existent pas en latin1 : on ne teste que les lettres accentuées
    const simple = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0xe0, 0x20, 0x35]); // « Café à 5 » en Windows-1252
    expect(decodeText(simple)).toBe('Café à 5');
    expect(decodeText(simple, 'iso-8859-1')).toBe('Café à 5');
    expect(decodeText(simple, 'windows-1252')).toBe('Café à 5');
    expect(decodeText(latin).startsWith('Café à 5')).toBe(true);
  });

  it('ne croit pas un jeu de caractères annoncé qui donne des caractères de remplacement', () => {
    const utf8 = Buffer.from('Élan', 'utf8');
    expect(decodeText(utf8, 'ascii-bidon')).toBe('Élan');
    expect(decodeText(utf8, 'utf-8')).toBe('Élan');
  });

  it('sniffHtmlCharset lit la déclaration de la page', () => {
    expect(sniffHtmlCharset(Buffer.from('<html><head><meta charset="ISO-8859-15"><title>x</title>'))).toBe('iso-8859-15');
    expect(sniffHtmlCharset(Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'))).toBe('windows-1252');
    expect(sniffHtmlCharset(Buffer.from('<p>rien</p>'))).toBeNull();
  });

  it('looksBinary : des octets nuls en nombre, sauf UTF-16', () => {
    expect(looksBinary(Buffer.from([1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 5, 6]))).toBe(true);
    expect(looksBinary(Buffer.from('texte normal'))).toBe(false);
    expect(looksBinary(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('texte', 'utf16le')]))).toBe(false);
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe('extractPlain', () => {
  it('nettoie : retours Windows, espaces, lignes vides en trop, caractères invisibles', () => {
    expect(extractPlain(Buffer.from('Un  texte\r\n\r\n\r\n\r\navec\u200B un trou insécable\u202E.'))).toBe('Un texte\n\navec un trou insécable.');
  });

  it('retire l’en-tête YAML d’un fichier Markdown, et garde les intertitres', () => {
    const md = '---\ntitle: Tarifs\ntags: [a, b]\n---\n# Livraison\n\nOffert dès 60 €.\n';
    expect(extractPlain(Buffer.from(md))).toBe('# Livraison\n\nOffert dès 60 €.');
    expect(extractPlain(Buffer.from('---\nun séparateur seulement\n\nsuite'))).toBe('---\nun séparateur seulement\n\nsuite');
  });

  it('refuse un fichier binaire', () => {
    expect(code(() => extractPlain(Buffer.alloc(100)))).toBe('corrupt');
  });
});

describe('CSV', () => {
  it('parseCsv : guillemets, guillemets doublés, retours à la ligne dans un champ, lignes vides', () => {
    expect(parseCsv('a,b,c\n"x, y","dit ""oui""","ligne 1\nligne 2"\n\n,,\nz,,\n', ',')).toEqual([
      ['a', 'b', 'c'], ['x, y', 'dit "oui"', 'ligne 1\nligne 2'], ['z', '', ''],
    ]);
    expect(parseCsv('a;b\r\n1;2\r\n', ';')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('une ligne d’en-tête : chaque rangée devient « Colonne : valeur », une par paragraphe', () => {
    const csv = 'Produit,Prix,Délai\nTable chêne,890 €,4 semaines\nChaise,120 €,\n';
    expect(extractCsv(Buffer.from(csv))).toBe('Produit : Table chêne | Prix : 890 € | Délai : 4 semaines\n\nProduit : Chaise | Prix : 120 €');
  });

  it('détecte le point-virgule et la tabulation, et lit un BOM', () => {
    expect(extractCsv(Buffer.from('\uFEFFNom;Ville\nLéa;Lyon\n'))).toBe('Nom : Léa | Ville : Lyon');
    expect(extractCsv(Buffer.from('Nom\tVille\nLéa\tLyon'))).toBe('Nom : Léa | Ville : Lyon');
  });

  it('sans ligne d’en-tête (nombres), les cellules sont simplement séparées', () => {
    expect(extractCsv(Buffer.from('1,2,3\n4,5,6'))).toBe('1 | 2 | 3\n\n4 | 5 | 6');
    expect(extractCsv(Buffer.from('Seule ligne,avec texte'))).toBe('Seule ligne | avec texte');
  });

  it('plafonne le nombre de lignes, accepte un fichier vide, refuse un fichier binaire', () => {
    const many = `A,B\n${Array.from({ length: 100 }, (_, i) => `v${i},w${i}`).join('\n')}`;
    expect(extractCsv(Buffer.from(many), 10).split('\n\n')).toHaveLength(10);
    expect(extractCsv(Buffer.from(''))).toBe('');
    expect(code(() => extractCsv(Buffer.alloc(100)))).toBe('corrupt');
  });
});
