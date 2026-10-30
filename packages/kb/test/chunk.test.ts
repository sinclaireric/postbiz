import { describe, expect, it } from 'vitest';
import { chunkKnowledge, chunkSource } from '../src/chunk.ts';
import { KB } from '../src/constants.ts';

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

describe('chunkKnowledge : découper une fiche en passages', () => {
  it('un texte court reste en un seul passage, avec son titre pour contexte', () => {
    const [only, ...rest] = chunkKnowledge('Ton de la marque', 'Nous tutoyons nos clients. Ton chaleureux et simple.');
    expect(rest).toEqual([]);
    expect(only).toEqual({ content: 'Nous tutoyons nos clients. Ton chaleureux et simple.', heading: null, embedText: 'Ton de la marque\nNous tutoyons nos clients. Ton chaleureux et simple.' });
  });

  it('un texte vide ou fait d’espaces n’a aucun passage', () => {
    expect(chunkKnowledge('Titre', '')).toEqual([]);
    expect(chunkKnowledge('Titre', ' \n\n \t ')).toEqual([]);
  });

  it('les intertitres (markdown ou « Libellé : ») deviennent la section des passages qui suivent, et se retrouvent dans le texte vectorisé', () => {
    const long = (s: string) => `${s} ${'et encore un peu de contenu pour dépasser la taille minimale d’un passage. '.repeat(8)}`;
    const chunks = chunkKnowledge('Tarifs', `# Livraison\n\n${long('Gratuite dès 60 euros.')}\n\nLivraison express :\n${long('Sous 24 heures.')}\n\n## Retours\n${long('Sous 30 jours.')}`);
    expect(chunks.map((c) => c.heading)).toEqual(['Livraison', 'Livraison express', 'Retours']);
    expect(chunks[1]!.embedText.startsWith('Tarifs > Livraison express\n')).toBe(true);
    expect(chunks[0]!.content).not.toContain('# Livraison');
  });

  it('de petites sections voisines tiennent dans un seul passage : le titre de chacune reste dans le texte, le repère est celui de la première', () => {
    const [only, ...rest] = chunkKnowledge('Atelier', '# Horaires\n\nOuvert le samedi.\n\n# Livraison\n\nOfferte dès 60 euros.\n\nRetours possibles.\n\n# Garantie\n\nCinq ans.');
    expect(rest).toEqual([]);
    expect(only!.heading).toBe('Horaires');
    expect(only!.content).toBe('Ouvert le samedi.\n\nLivraison\nOfferte dès 60 euros.\n\nRetours possibles.\n\nGarantie\nCinq ans.');
    expect(only!.embedText).toBe(`Atelier > Horaires\n${only!.content}`);
  });

  it('un texte qui commence avant tout intertitre : celui de la première section vient aussi dans le texte', () => {
    const [only] = chunkKnowledge('Atelier', 'Bienvenue chez nous.\n\n# Horaires\n\nOuvert le samedi.');
    expect(only).toMatchObject({ heading: null, content: 'Bienvenue chez nous.\n\nHoraires\nOuvert le samedi.' });
  });

  it('un dernier passage court rattaché au précédent garde lui aussi son titre', () => {
    const grand = 'Un paragraphe de belle taille sur le bois massif. '.repeat(40).trim();
    const chunks = chunkKnowledge('Atelier', `# Matériaux\n\n${grand}\n\n# Garantie\n\nCinq ans.`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('Matériaux');
    expect(chunks[0]!.content.endsWith('\n\nGarantie\nCinq ans.')).toBe(true);
  });

  it('un passage qui change de section n’a pas de titre en double : seule la nouvelle section est annoncée', () => {
    const [only] = chunkKnowledge('Atelier', '# Horaires\n\nOuvert le samedi.\n\nFermé le dimanche.');
    expect(only!.content).toBe('Ouvert le samedi.\n\nFermé le dimanche.');
  });

  it('un élément de liste qui finit par « : » annonce une sous-liste, il n’ouvre pas une section ; une ligne seule « Libellé : » en ouvre une', () => {
    const [only] = chunkKnowledge('Liens', 'Livraison :\nSous 3 jours.\n\n- Notices dans des dictionnaires :\n- Britannica\n- Larousse\n\n1. Pièces suivantes :\n- Table');
    expect(only!.heading).toBe('Livraison');
    expect(only!.content).toContain('- Notices dans des dictionnaires :');
    expect(only!.content).toContain('1. Pièces suivantes :');
    expect(only!.content).not.toContain('Notices dans des dictionnaires\n');
  });

  it('un texte long est découpé en passages d’au plus la taille visée, sans perdre un mot', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i} : ${'le bois massif vieillit bien. '.repeat(12)}`.trim());
    const text = paragraphs.join('\n\n');
    const chunks = chunkKnowledge('Atelier', text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect([...c.content].length).toBeLessThanOrEqual(Math.floor(KB.chunkChars * 1.25));
    // Aucun mot perdu : les paragraphes sont rattachés tels quels, sans reprise entre eux.
    expect(words(chunks.map((c) => c.content).join(' '))).toEqual(words(text));
  });

  it('un paragraphe plus long qu’un passage est coupé aux phrases, avec reprise de la fin du morceau précédent', () => {
    const sentences = Array.from({ length: 80 }, (_, i) => `Phrase numéro ${i} de ce très long paragraphe.`);
    const chunks = chunkKnowledge('Long', sentences.join(' '));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect([...c.content].length).toBeLessThanOrEqual(KB.chunkChars);
    const joined = chunks.map((c) => c.content).join(' ');
    for (const s of sentences) expect(joined).toContain(s);
    // La fin d'un passage se retrouve au début du suivant.
    const tail = chunks[0]!.content.split(' ').slice(-3).join(' ');
    expect(chunks[1]!.content).toContain(tail);
  });

  it('un mot démesuré (une adresse) est coupé sans casser un caractère', () => {
    const url = `https://exemple.fr/${'é'.repeat(KB.chunkChars * 2)}`;
    const chunks = chunkKnowledge('Lien', url);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Aucun signe perdu ni abîmé (les morceaux rattachés entre eux sont séparés par une ligne vide).
    expect(chunks.map((c) => c.content).join('').replace(/\s+/g, '')).toBe(url);
    for (const c of chunks) expect([...c.content].length).toBeLessThanOrEqual(Math.floor(KB.chunkChars * 1.25));
  });

  it('un dernier passage trop court est rattaché au précédent', () => {
    const body = (n: number) => `${'Mot '.repeat(n)}`.trim();
    const chunks = chunkKnowledge('T', `${body(500)}\n\n${body(100)}\n\nFin.`);
    // 2 000 + 400 signes tiennent ensemble : un seul passage.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content.endsWith('Fin.')).toBe(true);
  });

  it('est déterministe, et ne dépasse jamais le plafond de passages d’une fiche', () => {
    const text = Array.from({ length: 400 }, (_, i) => `Bloc ${i} ${'x'.repeat(2_000)}`).join('\n\n');
    const a = chunkKnowledge('T', text);
    expect(a.length).toBe(KB.maxChunksPerItem);
    expect(chunkKnowledge('T', text)).toEqual(a);
  });

  it('normalise les retours à la ligne Windows', () => {
    expect(chunkKnowledge('T', 'Ligne un.\r\n\r\nLigne deux.')[0]!.content).toBe('Ligne un.\n\nLigne deux.');
  });
});

describe('chunkSource : documents longs et pages', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Bloc ${i} ${'x'.repeat(2_000)}`).join('\n\n');

  it('plafonne au nombre demandé et dit si le texte en aurait donné davantage', () => {
    const all = chunkSource('Doc', long, 1_000);
    expect(all.truncated).toBe(false);
    expect(all.chunks.length).toBeGreaterThan(20);
    const cut = chunkSource('Doc', long, 5);
    expect(cut.chunks).toHaveLength(5);
    expect(cut.truncated).toBe(true);
    expect(cut.chunks).toEqual(all.chunks.slice(0, 5));
  });

  it('un texte vide ne donne rien', () => {
    expect(chunkSource('Doc', '  \n ', 10)).toEqual({ chunks: [], truncated: false });
  });

  it('un texte sans sauts de page n’a pas de pages', () => {
    expect(chunkKnowledge('T', 'Un seul bloc de texte.')[0]).not.toHaveProperty('pages');
  });

  it('retient les pages couvertes par chaque passage (sauts de page U+000C)', () => {
    const page = (n: number) => `Page ${n}. ${'mot '.repeat(300)}`.trim();
    const chunks = chunkSource('PDF', [page(1), page(2), page(3), page(4)].join('\f'), 10).chunks;
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.pages![0]).toBe(1);
    expect(chunks[chunks.length - 1]!.pages![1]).toBe(4);
    for (const c of chunks) expect(c.pages![0]).toBeLessThanOrEqual(c.pages![1]);
    // Les pages se suivent d'un passage à l'autre, sans trou ni retour en arrière.
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.pages![0]).toBeGreaterThanOrEqual(chunks[i - 1]!.pages![0]);
  });

  it('une page courte seule garde son numéro, et une section continue d’une page à l’autre', () => {
    const [only] = chunkKnowledge('PDF', '## Tarifs\nLivraison offerte.\fSuite des tarifs : reprise gratuite.');
    expect(only).toMatchObject({ heading: 'Tarifs', pages: [1, 2] });
  });
});
