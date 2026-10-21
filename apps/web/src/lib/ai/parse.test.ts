import { describe, expect, it } from 'vitest';
import { cleanPostText, normalizeIdeas, normalizeProposals, normalizeUrl, parseJsonText } from './parse';

const fitsIn = (max: number) => (text: string) => [...text].length <= max;

describe('lecture des réponses du modèle', () => {
  it('lit un JSON nu, entouré de texte ou dans une clôture de code', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('Voici :\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('pas du JSON')).toBeNull();
    expect(parseJsonText('{cassé')).toBeNull();
  });

  it('nettoie un texte de post', () => {
    expect(cleanPostText('  « Bonjour tout le monde »  ')).toBe('Bonjour tout le monde');
    expect(cleanPostText('"Bonjour"')).toBe('Bonjour');
    expect(cleanPostText('Il a dit "oui" puis "non"')).toBe('Il a dit "oui" puis "non"');
    expect(cleanPostText('```\nTexte\n```')).toBe('Texte');
    expect(cleanPostText('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  it('garde les propositions utiles : non vides, dans la limite, sans doublon, en nombre voulu', () => {
    const raw = { proposals: [{ text: 'Un' }, { text: ' un ' }, { text: '' }, { text: 'x'.repeat(300) }, { text: 'Deux' }, { text: 'Trois' }, { text: 'Quatre' }, 'pas un objet'] };
    expect(normalizeProposals(raw, fitsIn(280), 3)).toEqual([{ text: 'Un' }, { text: 'Deux' }, { text: 'Trois' }]);
    expect(normalizeProposals({ proposals: 'non' }, fitsIn(280), 3)).toEqual([]);
    expect(normalizeProposals(null, fitsIn(280), 3)).toEqual([]);
  });

  it('normalise les adresses pour les comparer', () => {
    expect(normalizeUrl('https://exemple.fr/a/#haut')).toBe('https://exemple.fr/a');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('pas une adresse')).toBeNull();
  });

  const sources = [{ title: 'Le Monde', url: 'https://lemonde.example/article-1' }];
  const idea = (over: Record<string, unknown>) => ({ title: 'Titre', angle: 'Parce que', text: 'Texte du post', origin: 'news', source_url: 'https://lemonde.example/article-1', ...over });

  it('une idée d’actualité n’est gardée que si sa source a été trouvée par la recherche', () => {
    const raw = { ideas: [idea({}), idea({ source_url: 'https://invente.example/faux' }), idea({ source_url: '' }), idea({ source_url: 'https://lemonde.example/article-1#x', title: 'Autre' })] };
    const ideas = normalizeIdeas(raw, fitsIn(280), sources, true, true);
    expect(ideas.map((i) => i.title)).toEqual(['Titre', 'Autre']);
    expect(ideas[0]!.source).toEqual({ title: 'Le Monde', url: 'https://lemonde.example/article-1' });
  });

  it('une idée tirée de la base n’a pas de source, et n’est gardée que si la base est utilisée', () => {
    const raw = { ideas: [idea({ origin: 'knowledge', source_url: '', title: 'Base' })] };
    expect(normalizeIdeas(raw, fitsIn(280), [], false, true)).toEqual([{ title: 'Base', angle: 'Parce que', text: 'Texte du post', origin: 'knowledge', source: null }]);
    expect(normalizeIdeas(raw, fitsIn(280), [], false, false)).toEqual([]);
  });

  it('écarte les idées trop longues ou sans titre, et plafonne leur nombre', () => {
    expect(normalizeIdeas({ ideas: [idea({ text: 'x'.repeat(400) }), idea({ title: '' })] }, fitsIn(280), sources, true, true)).toEqual([]);
    const many = { ideas: Array.from({ length: 9 }, (_, n) => idea({ title: `Idée ${n}`, text: `Texte ${n}` })) };
    expect(normalizeIdeas(many, fitsIn(280), sources, true, true)).toHaveLength(4);
  });
});
