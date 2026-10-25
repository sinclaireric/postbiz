import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeRepository } from '@/lib/data/types';
import type { Embedder } from './embed';
import { isRelevant, NOTHING, RELEVANCE, retrieve } from './retrieve';
import { KB, type KnowledgeHit, type KnowledgeSearchQuery } from './types';

const hit = (over: Partial<KnowledgeHit> = {}): KnowledgeHit => ({ chunkId: 'c1', itemId: 'i1', title: 'Tarifs', content: 'Livraison offerte dès 60 euros.', heading: null, similarity: 0, termHits: 0, score: 0.02, ...over });

function setup(hits: KnowledgeHit[] | Error, embedder: Embedder | null = { embed: async () => [[0.1, 0.2]] }) {
  const queries: KnowledgeSearchQuery[] = [];
  const knowledge: Pick<KnowledgeRepository, 'search'> = { search: async (q) => { queries.push(q); if (hits instanceof Error) throw hits; return hits; } };
  return { deps: { knowledge, embedder }, queries };
}

describe('isRelevant', () => {
  it('par le sens : une similarité d’au moins le seuil, seulement si la question a un vecteur', () => {
    expect(isRelevant({ similarity: RELEVANCE.minSimilarity, termHits: 0 }, 3, true)).toBe(true);
    expect(isRelevant({ similarity: RELEVANCE.minSimilarity - 0.01, termHits: 0 }, 3, true)).toBe(false);
    expect(isRelevant({ similarity: 0.9, termHits: 0 }, 3, false)).toBe(false);
  });

  it('par les mots : au moins deux mots (un seul si la question n’en a qu’un) et près d’un tiers d’entre eux', () => {
    expect(isRelevant({ similarity: 0, termHits: 1 }, 1, false)).toBe(true);
    expect(isRelevant({ similarity: 0, termHits: 1 }, 3, false)).toBe(false);
    expect(isRelevant({ similarity: 0, termHits: 2 }, 3, false)).toBe(true);
    expect(isRelevant({ similarity: 0, termHits: 2 }, 6, false)).toBe(true);
    expect(isRelevant({ similarity: 0, termHits: 2 }, 7, false)).toBe(false);
    expect(isRelevant({ similarity: 0, termHits: 3 }, 10, false)).toBe(true);
    expect(isRelevant({ similarity: 0, termHits: 5 }, 0, false)).toBe(false);
  });
});

describe('retrieve', () => {
  it('une question vide ne cherche rien', async () => {
    const { deps, queries } = setup([hit()]);
    expect(await retrieve(deps, '   ')).toBe(NOTHING);
    expect(queries).toEqual([]);
  });

  it('cherche par le sens et par les mots, et ne garde que les passages pertinents', async () => {
    const { deps, queries } = setup([
      hit({ chunkId: 'a', title: 'Tarifs', similarity: 0.52, termHits: 2 }),
      hit({ chunkId: 'b', title: 'FAQ', similarity: 0.1, termHits: 0 }),
      hit({ chunkId: 'c', title: 'Tarifs', similarity: 0, termHits: 2 }),
    ]);
    const r = await retrieve(deps, 'Livraison offerte dès combien ?', { exclude: ['pinned1'] });
    expect(queries).toEqual([{ embedding: [0.1, 0.2], terms: ['livraison', 'offerte', 'dès', 'combien'], limit: KB.searchLimit, perItem: KB.perItem, exclude: ['pinned1'] }]);
    expect(r.mode).toBe('hybrid');
    expect(r.passages.map((p) => p.chunkId)).toEqual(['a', 'c']);
    expect(r.passages[0]!.termCount).toBe(4);
    expect(r.all.map((p) => [p.chunkId, p.relevant])).toEqual([['a', true], ['b', false], ['c', true]]);
    expect(r.found).toBe(true);
    expect(r.consulted).toEqual(['Tarifs']);
  });

  it('rien de pertinent : found est faux, mais la liste complète reste disponible (page « Tester une question »)', async () => {
    const { deps } = setup([hit({ similarity: 0.05, termHits: 0 })]);
    const r = await retrieve(deps, 'horaires dimanche');
    expect(r.found).toBe(false);
    expect(r.passages).toEqual([]);
    expect(r.consulted).toEqual([]);
    expect(r.all).toHaveLength(1);
  });

  it('sans service d’embeddings, ou s’il tombe en panne, la recherche se fait par les mots seulement', async () => {
    const none = setup([hit({ termHits: 2 })], null);
    const a = await retrieve(none.deps, 'livraison offerte');
    expect(none.queries[0]!.embedding).toBeNull();
    expect(a.mode).toBe('words');
    expect(a.found).toBe(true);

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = setup([hit({ termHits: 2 })], { embed: async () => { throw new Error('boum'); } });
    const b = await retrieve(down.deps, 'livraison offerte');
    expect(down.queries[0]!.embedding).toBeNull();
    expect(b.mode).toBe('words');
    expect(b.found).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain('livraison');
    log.mockRestore();
  });

  it('une base qui ne répond pas : rien trouvé, jamais d’exception', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = setup(new Error('knowledge_search : 57014'));
    expect(await retrieve(deps, 'livraison offerte')).toBe(NOTHING);
    log.mockRestore();
  });

  it('la question est nettoyée et bornée avant d’être vectorisée', async () => {
    const texts: string[] = [];
    const { deps } = setup([], { embed: async (t) => { texts.push(...t); return [[1]]; } });
    await retrieve(deps, `  Bonjour\n\n  ${'x'.repeat(2_000)}  `);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.length).toBe(KB.queryChars);
    expect(texts[0]!.startsWith('Bonjour xxx')).toBe(true);
  });

  it('transmet la limite demandée', async () => {
    const { deps, queries } = setup([]);
    await retrieve(deps, 'livraison', { limit: 8 });
    expect(queries[0]!.limit).toBe(8);
  });
});
