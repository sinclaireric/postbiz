import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMBEDDING_MODEL, defaultEmbedder, embeddingModel, embeddingsConfigured, sdkEmbedder } from '../src/embed.ts';
import { KB } from '../src/constants.ts';

afterEach(() => {
  delete process.env.OPENAI_EMBEDDING_MODEL;
  delete process.env.OPENAI_API_KEY;
});

const vector = (seed: number) => Array.from({ length: KB.dimensions }, (_, i) => (seed + i) / 10_000);
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

/** Un faux serveur d'embeddings : rend un vecteur par texte (le numéro du texte comme graine), dans l'ordre inverse pour vérifier qu'on trie par `index`. */
function server(over: { badDimensions?: boolean; shortAnswer?: boolean } = {}) {
  const calls: { model: string; input: string[]; dimensions: number; encoding_format: string }[] = [];
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as (typeof calls)[number];
    calls.push(body);
    const data = body.input.map((text, index) => ({ object: 'embedding', index, embedding: over.badDimensions ? [0.1, 0.2] : vector(Number(text.replace(/\D/g, '')) || 0) })).reverse();
    return json({ object: 'list', model: body.model, data: over.shortAnswer ? data.slice(1) : data, usage: { prompt_tokens: 1, total_tokens: 1 } });
  });
  const embedder = sdkEmbedder(() => new OpenAI({ apiKey: 'cle-de-test', fetch: fetcher as unknown as typeof fetch, maxRetries: 0 }));
  return { calls, fetcher, embedder };
}

describe('configuration des embeddings', () => {
  it('le modèle large, réglable ; le service n’existe qu’avec une clé OpenAI', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('text-embedding-3-large');
    expect(embeddingModel()).toBe('text-embedding-3-large');
    process.env.OPENAI_EMBEDDING_MODEL = ' text-embedding-3-small ';
    expect(embeddingModel()).toBe('text-embedding-3-small');

    expect(embeddingsConfigured()).toBe(false);
    expect(defaultEmbedder()).toBeNull();
    process.env.OPENAI_API_KEY = '  ';
    expect(embeddingsConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'cle-de-test';
    expect(embeddingsConfigured()).toBe(true);
    expect(defaultEmbedder()).not.toBeNull();
  });

  it('ne crée pas le client sans appel (le SDK refuse de se construire sans clé)', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => sdkEmbedder()).not.toThrow();
  });
});

describe('sdkEmbedder', () => {
  it('demande des vecteurs de 1024 dimensions au modèle large, et les rend dans l’ordre des textes', async () => {
    const { embedder, calls } = server();
    const out = await embedder.embed(['texte 1', 'texte 2', 'texte 3']);
    expect(calls).toEqual([{ model: 'text-embedding-3-large', input: ['texte 1', 'texte 2', 'texte 3'], dimensions: 1024, encoding_format: 'float' }]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(vector(1));
    expect(out[2]).toEqual(vector(3));
  });

  it('découpe les gros envois en lots de 64 textes', async () => {
    const { embedder, calls } = server();
    const texts = Array.from({ length: 130 }, (_, i) => `texte ${i}`);
    const out = await embedder.embed(texts);
    expect(calls.map((c) => c.input.length)).toEqual([64, 64, 2]);
    expect(out).toHaveLength(130);
    expect(out[129]).toEqual(vector(129));
  });

  it('un texte vide à vectoriser : aucun appel', async () => {
    const { embedder, fetcher } = server();
    expect(await embedder.embed([])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('une réponse qui n’a pas la bonne forme (dimensions, nombre de vecteurs) est une erreur, jamais des vecteurs faux', async () => {
    await expect(server({ badDimensions: true }).embedder.embed(['a'])).rejects.toThrow(/inattendue/);
    await expect(server({ shortAnswer: true }).embedder.embed(['a', 'b'])).rejects.toThrow(/inattendue/);
  });

  it('le modèle choisi dans l’environnement est celui qui est demandé', async () => {
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
    const { embedder, calls } = server();
    await embedder.embed(['a']);
    expect(calls[0]!.model).toBe('text-embedding-3-small');
  });
});
