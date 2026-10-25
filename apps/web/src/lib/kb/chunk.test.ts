import { describe, expect, it } from 'vitest';
import { chunkKnowledge } from './chunk';
import { KB } from './types';

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
