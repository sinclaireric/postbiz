import { describe, expect, it } from 'vitest';
import { AI_INPUT_LIMITS, parseAiRequest } from './request';

describe('demande à l’assistant (donnée venue du navigateur)', () => {
  it('lit une demande de rédaction et applique les valeurs par défaut', () => {
    expect(parseAiRequest({ mode: 'write', topic: '  Soldes d’hiver  ', networkIds: ['x', 'x', 'linkedin', 'inconnu'] })).toEqual({
      mode: 'write', topic: 'Soldes d’hiver', tone: 'professional', length: 'medium', networkIds: ['x', 'linkedin'], useKnowledge: true,
    });
  });

  it('refuse ce qui est vide, démesuré ou d’un autre type', () => {
    expect(parseAiRequest(null)).toBeNull();
    expect(parseAiRequest('texte')).toBeNull();
    expect(parseAiRequest({ mode: 'inconnu' })).toBeNull();
    expect(parseAiRequest({ mode: 'write', topic: '   ' })).toBeNull();
    expect(parseAiRequest({ mode: 'write', topic: 'x'.repeat(AI_INPUT_LIMITS.topic + 1) })).toBeNull();
    expect(parseAiRequest({ mode: 'write', topic: 42 })).toBeNull();
  });

  it('exige une action connue et un texte pour améliorer', () => {
    expect(parseAiRequest({ mode: 'improve', action: 'shorten', text: 'Bonjour', tone: 'humorous' })).toMatchObject({ mode: 'improve', action: 'shorten', tone: 'humorous', useKnowledge: false });
    expect(parseAiRequest({ mode: 'improve', action: 'supprimer-tout', text: 'Bonjour' })).toBeNull();
    expect(parseAiRequest({ mode: 'improve', action: 'fix', text: 'x'.repeat(AI_INPUT_LIMITS.text + 1) })).toBeNull();
  });

  it('un ton inconnu retombe sur le ton professionnel', () => {
    expect(parseAiRequest({ mode: 'write', topic: 'a', tone: 'sarcastique' })).toMatchObject({ tone: 'professional' });
  });

  it('les idées demandent au moins une source ; le thème est facultatif', () => {
    expect(parseAiRequest({ mode: 'ideas', news: false, knowledge: false })).toBeNull();
    expect(parseAiRequest({ mode: 'ideas', news: true, knowledge: false })).toMatchObject({ mode: 'ideas', theme: '', news: true, knowledge: false });
    expect(parseAiRequest({ mode: 'ideas', news: true, knowledge: true, theme: 'vélo' })).toMatchObject({ theme: 'vélo' });
    expect(parseAiRequest({ mode: 'ideas', news: true, knowledge: true, theme: 'x'.repeat(AI_INPUT_LIMITS.theme + 1) })).toBeNull();
  });
});
