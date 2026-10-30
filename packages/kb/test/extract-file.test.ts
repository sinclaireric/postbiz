import { describe, expect, it } from 'vitest';
import { SOURCE_LIMITS } from '../src/constants.ts';
import { ExtractError, extractFile } from '../src/extract/index.ts';
import { makeDocx, para } from './helpers/zip-writer.ts';
import { makePdf } from './helpers/pdf-writer.ts';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'aucune erreur';
  } catch (e) {
    return e instanceof ExtractError ? e.code : `autre : ${(e as Error).message}`;
  }
};

describe('extractFile : le bon lecteur selon l’extension', () => {
  it('texte et Markdown', async () => {
    expect((await extractFile(Buffer.from('# Tarifs\n\nLivraison offerte dès 60 euros.'), 'tarifs.md')).text).toBe('# Tarifs\n\nLivraison offerte dès 60 euros.');
    expect((await extractFile(Buffer.from('Un texte assez long pour passer le seuil.'), 'NOTES.TXT')).text).toBe('Un texte assez long pour passer le seuil.');
    expect((await extractFile(Buffer.from('Un texte assez long pour passer le seuil.'), 'a.markdown')).truncated).toBe(false);
  });

  it('CSV et HTML', async () => {
    expect((await extractFile(Buffer.from('Produit,Prix\nTable,890 euros\nChaise,120 euros\n'), 'prix.csv')).text).toBe('Produit : Table | Prix : 890 euros\n\nProduit : Chaise | Prix : 120 euros');
    const html = '<html><head><meta charset="iso-8859-1"></head><body><main><h1>Caf\xe9</h1><p>Un paragraphe assez long pour compter comme du texte de page.</p></main><footer>Rue des Lilas</footer></body></html>';
    const r = await extractFile(Buffer.from(html, 'latin1'), 'page.html');
    expect(r.text).toBe('# Café\n\nUn paragraphe assez long pour compter comme du texte de page.\n\nRue des Lilas');
  });

  it('Word', async () => {
    const r = await extractFile(makeDocx(para('Bonjour, voici nos conditions de livraison et de retour.')), 'conditions.docx');
    expect(r.text).toBe('Bonjour, voici nos conditions de livraison et de retour.');
    expect(r.pages).toBeUndefined();
  });

  it('PDF : texte, pages et nombre de pages', async () => {
    const pdf = makePdf([[{ text: 'Première page : les tarifs de livraison en France.', y: 650 }], [{ text: 'Deuxième page : les horaires de l\'atelier lyonnais.', y: 650 }]]);
    const r = await extractFile(pdf, 'catalogue.pdf');
    expect(r.pages).toBe(2);
    expect(r.text.split('\f')).toHaveLength(2);
  });
});

describe('extractFile : refus', () => {
  it('un type inconnu, ou sans extension', async () => {
    for (const name of ['photo.jpg', 'archive.zip', 'macro.xlsm', 'ancien.doc', 'sans-extension', 'fichier.', '.pdf.exe']) expect(await code(extractFile(Buffer.from('x'.repeat(100)), name)), name).toBe('unsupported_type');
  });

  it('un fichier trop grand ou vide', async () => {
    expect(await code(extractFile(Buffer.alloc(SOURCE_LIMITS.fileBytes + 1, 97), 'gros.txt'))).toBe('too_large');
    expect(await code(extractFile(Buffer.alloc(0), 'vide.txt'))).toBe('no_text');
    expect(await code(extractFile(Buffer.from('   \n\n  '), 'blanc.txt'))).toBe('no_text');
    expect(await code(extractFile(Buffer.from('court'), 'court.txt'))).toBe('no_text');
  });

  it('une extension qui ment : le contenu ne correspond pas', async () => {
    expect(await code(extractFile(Buffer.from('un simple texte qui prétend être un PDF, sans en être un'), 'faux.pdf'))).toBe('corrupt');
    expect(await code(extractFile(Buffer.from('un simple texte qui prétend être un document Word'), 'faux.docx'))).toBe('corrupt');
    expect(await code(extractFile(Buffer.alloc(200, 0), 'binaire.txt'))).toBe('corrupt');
    expect(await code(extractFile(Buffer.alloc(200, 0), 'binaire.csv'))).toBe('corrupt');
    expect(await code(extractFile(Buffer.alloc(200, 0), 'binaire.html'))).toBe('corrupt');
  });

  it('coupe un texte plus long que la limite à la fin d’un paragraphe, et le dit', async () => {
    const para = `${'mot '.repeat(250)}\n\n`;
    const r = await extractFile(Buffer.from(para.repeat(Math.ceil((SOURCE_LIMITS.fileBytes - 1000) / para.length))), 'long.txt');
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(SOURCE_LIMITS.textChars);
    expect(r.text.length).toBeGreaterThan(SOURCE_LIMITS.textChars * 0.8);
    expect(r.text.endsWith('mot')).toBe(true); // coupé entre deux paragraphes, pas au milieu d'un mot
  });
});
