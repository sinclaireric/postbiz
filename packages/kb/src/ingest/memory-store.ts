import type { KnowledgeChunkInput } from '../types.ts';
import type { SourceStore } from './types.ts';

/**
 * Les passages des sources gardés en mémoire : le mode démo du site, et les tests. Même règles que les fonctions SQL `knowledge_source_*` :
 * `applyPages` retire les passages des pages `drop` (repérées par `meta.url`) puis ajoute les nouveaux à la suite.
 */
export class MemorySourceStore implements SourceStore {
  readonly chunks = new Map<string, KnowledgeChunkInput[]>();
  touches = 0;

  async replaceAll(itemId: string, chunks: KnowledgeChunkInput[]): Promise<number> {
    this.chunks.set(itemId, [...chunks]);
    return chunks.length;
  }

  async pages(itemId: string): Promise<Map<string, { hash: string; chunks: number; embedded: number }>> {
    const out = new Map<string, { hash: string; chunks: number; embedded: number }>();
    for (const c of this.chunks.get(itemId) ?? []) {
      const url = c.meta.url;
      if (!url) continue;
      const page = out.get(url) ?? { hash: c.meta.hash ?? '', chunks: 0, embedded: 0 };
      page.chunks++;
      if (c.embedding) page.embedded++;
      out.set(url, page);
    }
    return out;
  }

  async applyPages(itemId: string, o: { chunks: KnowledgeChunkInput[]; drop: string[] }): Promise<number> {
    const drop = new Set(o.drop);
    const kept = (this.chunks.get(itemId) ?? []).filter((c) => !(c.meta.url && drop.has(c.meta.url)));
    const all = [...kept, ...o.chunks];
    this.chunks.set(itemId, all);
    return all.length;
  }

  async touch(): Promise<void> {
    this.touches++;
  }
}
