import { describe, expect, it } from 'vitest';
import { knowledgeBlock, knowledgeEntrySize, KNOWLEDGE_BUDGET } from '@/lib/ai/prompt';
import type { KnowledgeItem } from '@/lib/data/types';
import { splitKnowledge } from './split';

const item = (id: string, over: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id, title: `Fiche ${id}`, content: 'Contenu de la fiche.', updatedAt: '2026-10-27T10:00:00Z', pinned: true, chunkCount: 1, indexedAt: '2026-10-27T10:00:00Z', embeddedAt: null, ...over,
});

describe('splitKnowledge : ce qui part en entier, ce qui se cherche', () => {
  it('les fiches épinglées partent en entier, les autres se cherchent', () => {
    const s = splitKnowledge([item('a'), item('b', { pinned: false }), item('c')]);
    expect(s.inPrompt.map((i) => i.id)).toEqual(['a', 'c']);
    expect(s.searchable.map((i) => i.id)).toEqual(['b']);
    expect(s.overflow).toEqual([]);
    expect(s.pinnedChars).toBe(knowledgeEntrySize(item('a')) + knowledgeEntrySize(item('c')));
  });

  it('au-delà du budget, la fiche qui ne tient plus et les suivantes passent du côté de la recherche : rien n’est écarté en silence', () => {
    const big = (id: string) => item(id, { content: 'x'.repeat(15_000) });
    // Les deux premières tiennent (30 000 signes) ; la troisième ferait 45 000 : elle ne tient plus, et la petite qui la suit non plus, comme `knowledgeBlock` s'arrête à la première.
    const s = splitKnowledge([big('1'), big('2'), big('3'), item('4', { content: 'petite' })], 40_000);
    expect(s.inPrompt.map((i) => i.id)).toEqual(['1', '2']);
    expect(s.overflow.map((i) => i.id)).toEqual(['3', '4']);
    expect(s.searchable.map((i) => i.id)).toEqual(['3', '4']);
  });

  it('compte comme le prompt : ce qui est dans « inPrompt » est bien ce que `knowledgeBlock` envoie', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(String(i), { content: 'y'.repeat(7_000) }));
    const s = splitKnowledge(items);
    const block = knowledgeBlock(s.inPrompt.map(({ title, content }) => ({ title, content })))!;
    for (const kept of s.inPrompt) expect(block).toContain(kept.title);
    for (const dropped of s.overflow) expect(block).not.toContain(dropped.title);
    expect(s.pinnedChars).toBeLessThanOrEqual(KNOWLEDGE_BUDGET);
  });

  it('une base vide', () => {
    expect(splitKnowledge([])).toEqual({ inPrompt: [], overflow: [], searchable: [], pinnedChars: 0 });
  });
});
