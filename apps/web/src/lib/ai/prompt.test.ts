import { describe, expect, it } from 'vitest';
import { CEILING_MAX_CHARS, DEFAULT_MAX_CHARS, fitsLimits, IDEAS_SCHEMA, improvePrompt, knowledgeBlock, languageName, maxCharsFor, networkBrief, newsResearchPrompt, PROPOSALS_SCHEMA, writePrompt } from './prompt';

const ctx = { orgName: 'Maison Lune', language: 'French', today: '2026-10-21' };

describe('prompts de l’assistant', () => {
  it('plafonne la longueur sur le canal le plus strict', () => {
    expect(maxCharsFor([])).toBe(DEFAULT_MAX_CHARS);
    expect(maxCharsFor(['x', 'linkedin'])).toBe(280);
    expect(maxCharsFor(['facebook'])).toBe(CEILING_MAX_CHARS);
  });

  it('mesure la longueur comme le fait chaque réseau', () => {
    const fits = fitsLimits(['x', 'linkedin']);
    expect(fits('a'.repeat(280))).toBe(true);
    expect(fits('a'.repeat(281))).toBe(false);
    // Sur X un émoji compte double : 141 émojis dépassent 280, mais tiennent sur LinkedIn.
    const emojis = '😀'.repeat(141);
    expect(fitsLimits(['x'])(emojis)).toBe(false);
    expect(fitsLimits(['linkedin'])(emojis)).toBe(true);
    // Sans canal choisi : la limite par défaut.
    expect(fitsLimits([])('a'.repeat(DEFAULT_MAX_CHARS))).toBe(true);
    expect(fitsLimits([])('a'.repeat(DEFAULT_MAX_CHARS + 1))).toBe(false);
  });

  it('décrit chaque canal choisi avec sa limite', () => {
    const brief = networkBrief(['x', 'instagram']);
    expect(brief).toContain('X: at most 280 characters');
    expect(brief).toContain('Instagram: at most 2200 characters');
    expect(networkBrief([])).toContain('works on any social network');
  });

  it('met la base de connaissance en bloc, dans la limite du budget', () => {
    const entries = [{ title: 'Ton', content: 'Tutoiement.' }, { title: 'Offre', content: 'Livraison offerte dès 60 €.' }];
    const block = knowledgeBlock(entries)!;
    expect(block).toContain('<entry title="Ton">');
    expect(block).toContain('Livraison offerte dès 60 €.');
    expect(knowledgeBlock([])).toBeNull();
    // Budget serré : la première fiche tient, pas la suivante.
    const tight = knowledgeBlock(entries, 60)!;
    expect(tight).toContain('Ton');
    expect(tight).not.toContain('Offre');
  });

  it('le texte à améliorer et le sujet sont isolés dans des balises, la langue et la date sont dites', () => {
    const p = writePrompt(ctx, { topic: 'Soldes', tone: 'friendly', length: 'short', networkIds: ['x'], useKnowledge: true });
    expect(p).toContain('<topic>\nSoldes\n</topic>');
    expect(p).toContain('Write in French');
    expect(p).toContain('Today is 2026-10-21');
    expect(p).toContain('at most 280 characters');
    expect(p).toContain('knowledge base');
    const i = improvePrompt(ctx, { action: 'shorten', text: 'Un long texte', tone: 'professional', networkIds: [], useKnowledge: false });
    expect(i).toContain('<text>\nUn long texte\n</text>');
    expect(i).toContain('Shorten');
    expect(i).not.toContain('knowledge base');
  });

  it('une action sans variantes multiples ne demande qu’une version', () => {
    expect(improvePrompt(ctx, { action: 'fix', text: 'a', tone: 'direct', networkIds: [], useKnowledge: false })).toContain('Return 1 version');
    expect(improvePrompt(ctx, { action: 'rewrite', text: 'a', tone: 'direct', networkIds: [], useKnowledge: false })).toContain('Return 3 different versions');
  });

  it('la recherche d’actualité ne rédige rien et reste fondée sur le thème ou la base', () => {
    expect(newsResearchPrompt(ctx, { theme: 'vélo', hasKnowledge: false })).toContain('Theme to follow: vélo');
    expect(newsResearchPrompt(ctx, { theme: '', hasKnowledge: true })).toContain('infer the organization');
    expect(newsResearchPrompt(ctx, { theme: 'vélo', hasKnowledge: false })).toContain('do not write any post');
  });

  it('nomme la langue en anglais', () => {
    expect(languageName('fr-FR')).toBe('French (France)');
    expect(languageName('ja')).toBe('Japanese');
  });

  it('les schémas de sortie sont stricts', () => {
    expect(PROPOSALS_SCHEMA.additionalProperties).toBe(false);
    expect(IDEAS_SCHEMA.properties.ideas.items.required).toEqual(['title', 'angle', 'text', 'origin', 'source_url']);
  });
});
