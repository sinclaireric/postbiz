import { describe, expect, it } from 'vitest';
import { ExtractError } from '../src/extract/errors.ts';
import { extractPdf } from '../src/extract/pdf.ts';
import { makePdf, type PdfLine } from './helpers/pdf-writer.ts';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'aucune erreur';
  } catch (e) {
    return e instanceof ExtractError ? e.code : `autre : ${(e as Error).message}`;
  }
};

/** Des lignes de texte courant (taille 12, interligne 14) à partir de y. */
const flow = (texts: string[], y = 650, size = 12, step = 14): PdfLine[] => texts.map((text, i) => ({ text, y: y - i * step, size }));

describe('extractPdf : lignes, paragraphes et intertitres', () => {
  it('rejoint les lignes d’un paragraphe, sépare les paragraphes (interligne plus grand)', async () => {
    const pdf = makePdf([[
      ...flow(['Notre atelier fabrique des meubles en bois massif', 'à Lyon depuis 2012. Chaque pièce est unique.']),
      ...flow(['Livraison en France et en Belgique.'], 590),
    ]]);
    const r = await extractPdf(pdf);
    expect(r.text).toBe('Notre atelier fabrique des meubles en bois massif à Lyon depuis 2012. Chaque pièce est unique.\n\nLivraison en France et en Belgique.');
    expect(r.pages).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('reconnaît les intertitres à la taille de la police, par rang', async () => {
    const pdf = makePdf([[
      { text: 'Catalogue 2026', y: 720, size: 24, bold: true },
      { text: 'Tables', y: 690, size: 16, bold: true },
      ...flow(['Chêne massif, huilé, quatre pieds.', 'Six personnes.'], 660),
      { text: 'Chaises', y: 600, size: 16, bold: true },
      ...flow(['Hêtre cintré, assise paillée.'], 570),
    ]]);
    const r = await extractPdf(pdf);
    expect(r.text).toBe('# Catalogue 2026\n\n## Tables\n\nChêne massif, huilé, quatre pieds. Six personnes.\n\n## Chaises\n\nHêtre cintré, assise paillée.');
  });

  it('un titre trop long pour une ligne, qui passe à la suivante, ne fait qu’un intertitre ; deux titres séparés restent deux', async () => {
    const pdf = makePdf([[
      { text: 'Catalogue 2026 de la Maison', y: 720, size: 24, bold: true },
      { text: 'Lune', y: 692, size: 24, bold: true },
      ...flow(['Des meubles en bois massif, fabriqués à Lyon.'], 660),
      { text: 'Tables', y: 600, size: 16, bold: true },
      { text: 'Chaises', y: 540, size: 16, bold: true },
      ...flow(['Hêtre cintré, assise paillée.'], 510),
    ]]);
    const r = await extractPdf(pdf);
    expect(r.text).toBe('# Catalogue 2026 de la Maison Lune\n\nDes meubles en bois massif, fabriqués à Lyon.\n\n## Tables\n\n## Chaises\n\nHêtre cintré, assise paillée.');
  });

  it('un titre sur trois lignes, ou deux titres de même taille rapprochés par un paragraphe, ne se mélangent pas', async () => {
    const triple = await extractPdf(makePdf([[
      { text: 'Conditions générales de vente et', y: 720, size: 22, bold: true },
      { text: 'de livraison de la boutique', y: 694, size: 22, bold: true },
      { text: 'Maison Lune', y: 668, size: 22, bold: true },
      ...flow(['Le texte des conditions commence ici, sur une première ligne,', 'puis se poursuit sur une seconde ligne, assez longue pour être du texte courant.'], 630),
    ]]));
    expect(triple.text).toBe('# Conditions générales de vente et de livraison de la boutique Maison Lune\n\nLe texte des conditions commence ici, sur une première ligne, puis se poursuit sur une seconde ligne, assez longue pour être du texte courant.');

    const apart = await extractPdf(makePdf([[
      { text: 'Livraison', y: 720, size: 20, bold: true },
      ...flow(['Offerte dès soixante euros.'], 696),
      { text: 'Retours', y: 670, size: 20, bold: true },
      ...flow(['Quatorze jours.'], 646),
    ]]));
    expect(apart.text).toBe('# Livraison\n\nOfferte dès soixante euros.\n\n# Retours\n\nQuatorze jours.');
  });

  it('recolle un mot coupé en fin de ligne, et sépare les puces', async () => {
    const pdf = makePdf([[
      ...flow(['Nous livrons gratuitement dans toute la mé-', 'tropole sous quinze jours.'], 650),
      ...flow(['- Chêne massif', '- Noyer huilé', '- Hêtre cintré'], 600),
    ]]);
    expect((await extractPdf(pdf)).text).toBe('Nous livrons gratuitement dans toute la métropole sous quinze jours.\n\n- Chêne massif\n\n- Noyer huilé\n\n- Hêtre cintré');
  });

  it('sépare les pages par U+000C, dans l’ordre, et compte les pages', async () => {
    const pdf = makePdf([flow(['Première page : les tarifs de livraison.']), flow(['Deuxième page : les horaires de l\'atelier.']), flow(['Troisième page : nous contacter par courrier.'])]);
    const r = await extractPdf(pdf);
    expect(r.text.split('\f')).toEqual(['Première page : les tarifs de livraison.', 'Deuxième page : les horaires de l\'atelier.', 'Troisième page : nous contacter par courrier.']);
    expect(r.pages).toBe(3);
  });

  it('retire les en-têtes, pieds de page et numéros qui se répètent', async () => {
    const page = (n: number): PdfLine[] => [
      { text: 'Maison Lune - Catalogue 2026', y: 760, size: 9 },
      ...flow([`Contenu propre à la page ${n} : des informations de livraison, de garantie et d\'entretien.`], 500),
      { text: `Page ${n} / 4`, y: 30, size: 9 },
    ];
    const r = await extractPdf(makePdf([page(1), page(2), page(3), page(4)]));
    expect(r.text).not.toMatch(/Catalogue 2026|Page \d/);
    expect(r.text.split('\f')).toHaveLength(4);
    expect(r.text.split('\f')[2]).toBe('Contenu propre à la page 3 : des informations de livraison, de garantie et d\'entretien.');
  });

  it('plafonne le nombre de pages lues et la longueur du texte, et le dit', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => flow([`Texte de la page numéro ${i + 1} avec assez de mots pour compter.`]));
    const some = await extractPdf(makePdf(pages), { maxPages: 2 });
    expect(some.text.split('\f')).toHaveLength(2);
    expect(some.pages).toBe(5);
    expect(some.truncated).toBe(true);
    const short = await extractPdf(makePdf(pages), { maxChars: 70 });
    expect(short.truncated).toBe(true);
    expect(short.text.replace(/\f/g, '').length).toBeLessThanOrEqual(70);
  });
});

describe('extractPdf : fichiers sans texte ou abîmés', () => {
  it('un PDF sans texte (scan : que des images) est refusé avec no_text', async () => {
    expect(await code(extractPdf(makePdf([[], []])))).toBe('no_text');
    expect(await code(extractPdf(makePdf([[{ text: 'a', y: 700 }]])))).toBe('no_text');
  });

  it('ce qui n’est pas un PDF, ou un PDF abîmé, donne corrupt', async () => {
    expect(await code(extractPdf(Buffer.from('ceci est un texte, pas un PDF')))).toBe('corrupt');
    expect(await code(extractPdf(Buffer.alloc(0)))).toBe('corrupt');
    const whole = makePdf([flow(['Un texte qui doit rester lisible pour le test.'])]);
    expect(await code(extractPdf(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('n’importe quoi '.repeat(50))])))).toBe('corrupt');
    // Un PDF dont on a coupé la fin : pdf.js sait parfois le reconstruire, parfois non.
    expect(['aucune erreur', 'corrupt', 'no_text']).toContain(await code(extractPdf(whole.subarray(0, Math.floor(whole.length * 0.6)))));
  });
});
