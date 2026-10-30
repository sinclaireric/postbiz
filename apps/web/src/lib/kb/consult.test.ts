import { describe, expect, it } from 'vitest';
import type { AiRequest } from '@/lib/ai/types';
import { textItem } from '@/lib/data/types';
import type { KnowledgeItem, KnowledgeRepository } from '@/lib/data/types';
import { assistQuery, consultForAssist, overviewPassages } from './consult';
import { splitKnowledge } from './split';
import type { KnowledgeHit, KnowledgeSearchQuery } from './types';

const item = (id: string, over: Partial<KnowledgeItem> = {}): KnowledgeItem => textItem({
  id, title: `Fiche ${id}`, content: `Contenu de la fiche ${id}.`, updatedAt: '2026-10-27T10:00:00Z', pinned: true, chunkCount: 1, indexedAt: '2026-10-27T10:00:00Z', embeddedAt: null, ...over,
});
const hit = (over: Partial<KnowledgeHit> = {}): KnowledgeHit => ({ chunkId: 'c1', itemId: 'b', title: 'Fiche b', content: 'Livraison offerte.', heading: null, similarity: 0, termHits: 2, score: 0.02, ...over });

const write: AiRequest = { mode: 'write', topic: 'Livraison offerte', tone: 'friendly', length: 'short', networkIds: [], useKnowledge: true };
const improve: AiRequest = { mode: 'improve', action: 'rewrite', text: 'Notre texte', tone: 'direct', networkIds: [], useKnowledge: true };
const ideas = (theme: string): AiRequest => ({ mode: 'ideas', theme, news: false, knowledge: true, tone: 'professional', networkIds: [] });

function deps(hits: KnowledgeHit[] = [hit()]) {
  const queries: KnowledgeSearchQuery[] = [];
  const knowledge: Pick<KnowledgeRepository, 'search'> = { search: async (q) => (queries.push(q), hits) };
  return { deps: { knowledge, embedder: null }, queries };
}

describe('assistQuery', () => {
  it('le sujet pour rédiger, le texte pour améliorer, le thème pour les idées', () => {
    expect(assistQuery(write)).toBe('Livraison offerte');
    expect(assistQuery(improve)).toBe('Notre texte');
    expect(assistQuery(ideas('vélo'))).toBe('vélo');
  });
});

describe('overviewPassages', () => {
  it('le début de chaque fiche, les plus récentes d’abord, au plus six, sans les fiches vides', () => {
    const items = [item('1', { content: 'x'.repeat(2_000) }), item('2', { content: '   ' }), ...Array.from({ length: 8 }, (_, i) => item(`n${i}`))];
    const out = overviewPassages(items);
    expect(out).toHaveLength(6);
    expect(out[0]!.content).toHaveLength(600);
    expect(out.map((p) => p.title)).not.toContain('Fiche 2');
  });
});

describe('consultForAssist', () => {
  const split = splitKnowledge([item('a'), item('b', { pinned: false })]);

  it('cherche ce que la demande évoque, hors des fiches déjà envoyées en entier', async () => {
    const { deps: d, queries } = deps();
    const r = await consultForAssist(write, d, split);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.exclude).toEqual(['a']);
    expect(queries[0]!.terms).toEqual(['livraison', 'offerte']);
    expect(r.passages.map((p) => p.chunkId)).toEqual(['c1']);
    expect(r.consulted).toEqual(['Fiche b']);
  });

  it('idées sans thème : pas de question, un aperçu de la base', async () => {
    const { deps: d, queries } = deps();
    const r = await consultForAssist(ideas('  '), d, split);
    expect(queries).toEqual([]);
    expect(r.passages.map((p) => p.title)).toEqual(['Fiche b']);
    expect(r.consulted).toEqual(['Fiche b']);
  });

  it('rien à consulter (aucune fiche non épinglée) : aucune recherche', async () => {
    const { deps: d, queries } = deps();
    expect(await consultForAssist(write, d, splitKnowledge([item('a')]))).toEqual({ passages: [], consulted: [] });
    expect(queries).toEqual([]);
  });

  it('une base qui ne répond pas ne casse pas la demande', async () => {
    const knowledge: Pick<KnowledgeRepository, 'search'> = { search: async () => { throw new Error('boum'); } };
    const r = await consultForAssist(write, { knowledge, embedder: null }, split);
    expect(r).toEqual({ passages: [], consulted: [] });
  });
});
