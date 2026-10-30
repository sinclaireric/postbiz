import { describe, expect, it, vi } from 'vitest';
import { textItem } from '@/lib/data/types';
import type { KnowledgeItem, KnowledgeRepository } from '@/lib/data/types';
import { indexItem, indexMissing } from './indexing';
import type { KnowledgeChunkInput } from './types';

const item = (id: string, over: Partial<KnowledgeItem> = {}): KnowledgeItem => textItem({
  id, title: `Fiche ${id}`, content: 'Livraison offerte dès 60 euros.', updatedAt: '2026-10-27T10:00:00Z', pinned: true, chunkCount: 0, indexedAt: null, embeddedAt: null, ...over,
});

function repo(result: { ok: boolean } = { ok: true }) {
  const written: { id: string; chunks: KnowledgeChunkInput[] }[] = [];
  const knowledge: Pick<KnowledgeRepository, 'replaceChunks'> = { replaceChunks: async (id, chunks) => (written.push({ id, chunks }), result) };
  return { knowledge, written };
}

describe('indexItem', () => {
  it('découpe la fiche, vectorise les passages en une requête et les écrit', async () => {
    const { knowledge, written } = repo();
    const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => [i, 1]));
    const res = await indexItem({ knowledge, embedder: { embed } }, item('a'));
    expect(res).toEqual({ ok: true, chunks: 1, embedded: true });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]![0]).toEqual(['Fiche a\nLivraison offerte dès 60 euros.']);
    expect(written).toEqual([{ id: 'a', chunks: [{ content: 'Livraison offerte dès 60 euros.', embedding: [0, 1], meta: {} }] }]);
  });

  it('la section d’un passage est gardée dans ses repères', async () => {
    const { knowledge, written } = repo();
    await indexItem({ knowledge, embedder: null }, item('a', { content: '# Livraison\nGratuite dès 60 euros.' }));
    expect(written[0]!.chunks[0]!.meta).toEqual({ heading: 'Livraison' });
  });

  it('sans service d’embeddings, les passages sont écrits sans vecteur : la fiche reste cherchable par ses mots', async () => {
    const { knowledge, written } = repo();
    const res = await indexItem({ knowledge, embedder: null }, item('a'));
    expect(res).toEqual({ ok: true, chunks: 1, embedded: false });
    expect(written[0]!.chunks[0]!.embedding).toBeNull();
  });

  it('un service d’embeddings qui échoue, ou qui rend un nombre de vecteurs inattendu, ne bloque pas l’indexation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = repo();
    expect(await indexItem({ knowledge: down.knowledge, embedder: { embed: async () => { throw new Error('boum'); } } }, item('a'))).toEqual({ ok: true, chunks: 1, embedded: false });
    expect(down.written[0]!.chunks[0]!.embedding).toBeNull();
    const short = repo();
    expect((await indexItem({ knowledge: short.knowledge, embedder: { embed: async () => [] } }, item('a'))).embedded).toBe(false);
    log.mockRestore();
  });

  it('un contenu sans texte n’a aucun passage et n’appelle pas le service d’embeddings', async () => {
    const { knowledge, written } = repo();
    const embed = vi.fn(async () => []);
    const res = await indexItem({ knowledge, embedder: { embed } }, item('a', { content: '   ' }));
    expect(res).toEqual({ ok: true, chunks: 0, embedded: false });
    expect(embed).not.toHaveBeenCalled();
    expect(written[0]!.chunks).toEqual([]);
  });

  it('une base qui refuse l’écriture : échec rapporté, rien n’est compté', async () => {
    const { knowledge } = repo({ ok: false });
    expect(await indexItem({ knowledge, embedder: null }, item('a'))).toEqual({ ok: false, chunks: 0, embedded: false });
  });
});

describe('indexMissing', () => {
  it('n’indexe que les fiches jamais indexées, par lots', async () => {
    const { knowledge, written } = repo();
    const items = [item('a', { indexedAt: '2026-10-27T10:00:00Z' }), item('b'), item('c'), item('d')];
    expect(await indexMissing({ knowledge, embedder: null }, items, 2)).toBe(2);
    expect(written.map((w) => w.id)).toEqual(['b', 'c']);
  });

  it('rien à faire : zéro', async () => {
    const { knowledge, written } = repo();
    expect(await indexMissing({ knowledge, embedder: null }, [item('a', { indexedAt: '2026-10-27T10:00:00Z' })])).toBe(0);
    expect(written).toEqual([]);
  });
});
