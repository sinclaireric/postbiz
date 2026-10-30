import { describe, expect, it, vi } from 'vitest';
import { KB, SOURCE_LIMITS } from '../src/constants.ts';
import { embedBatches } from '../src/ingest/embed.ts';
import { ingestFile, MemorySourceStore, SourceFailure } from '../src/ingest/index.ts';
import { fakeEmbedder } from './helpers/fake-site.ts';
import { makeDocx, para } from './helpers/zip-writer.ts';
import { makePdf } from './helpers/pdf-writer.ts';

const noWait = async () => undefined;
const failureOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'aucune erreur';
  } catch (e) {
    return e instanceof SourceFailure ? `${e.code}${e.transient ? ' (passagère)' : ''}` : `autre : ${(e as Error).message}`;
  }
};

describe('embedBatches : vectoriser par lots, sans jamais lever', () => {
  it('un vecteur par texte, dans l’ordre, par lots de 32', async () => {
    const { embedder, calls } = fakeEmbedder();
    const texts = Array.from({ length: 70 }, (_, i) => `texte ${i}`);
    const out = await embedBatches(embedder, texts, { wait: noWait });
    expect(calls.map((c) => c.length)).toEqual([32, 32, 6]);
    expect(out).toHaveLength(70);
    expect(out[0]).toEqual([7, 1, 0]);
    expect(out.every((v) => v !== null)).toBe(true);
  });

  it('sans service, ou sans texte : tout est null, aucun appel', async () => {
    expect(await embedBatches(null, ['a', 'b'])).toEqual([null, null]);
    const { embedder } = fakeEmbedder();
    expect(await embedBatches(embedder, [])).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it('réessaie un lot (1 s puis 3 s d’attente), puis le laisse sans vecteur sans gêner les autres', async () => {
    const waits: number[] = [];
    let call = 0;
    const embedder = {
      embed: vi.fn(async (texts: string[]) => {
        call++;
        // Le premier lot échoue toujours ; le second réussit.
        if (texts[0] === 'a0') throw new Error('panne');
        return texts.map(() => [1]);
      }),
    };
    const first = Array.from({ length: 32 }, (_, i) => `a${i}`);
    const second = ['b0', 'b1'];
    const out = await embedBatches(embedder, [...first, ...second], { wait: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([1_000, 3_000]);
    expect(out.slice(0, 32).every((v) => v === null)).toBe(true);
    expect(out.slice(32)).toEqual([[1], [1]]);
    expect(call).toBe(4); // 3 essais pour le premier lot, 1 pour le second
  });

  it('un lot qui réussit au deuxième essai est gardé ; une réponse incomplète est un échec', async () => {
    let n = 0;
    const flaky = { embed: vi.fn(async (texts: string[]) => (++n === 1 ? (() => { throw new Error('x'); })() : texts.map(() => [2]))) };
    expect(await embedBatches(flaky, ['a'], { wait: noWait })).toEqual([[2]]);
    const short = { embed: vi.fn(async () => [[1]]) };
    expect(await embedBatches(short, ['a', 'b'], { wait: noWait })).toEqual([null, null]);
  });

  it('s’arrête dès qu’on annule', async () => {
    const { embedder } = fakeEmbedder();
    const out = await embedBatches(embedder, ['a'], { signal: AbortSignal.abort(), wait: noWait });
    expect(out).toEqual([null]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });
});

describe('ingestFile', () => {
  const text = (n: number) => Array.from({ length: n }, (_, i) => `# Section ${i}\n\n${'Une phrase utile sur la livraison et les délais. '.repeat(10)}`).join('\n\n');

  it('lit, découpe, vectorise (avec le titre pour contexte) et écrit', async () => {
    const store = new MemorySourceStore();
    const { embedder, texts } = fakeEmbedder();
    const r = await ingestFile({ embedder, store, wait: noWait }, { id: 'f1', title: 'Conditions de vente', name: 'conditions.md', bytes: Buffer.from(text(3)) });
    expect(r.chunks).toBeGreaterThan(0);
    expect(r.embedded).toBe(true);
    expect(r.stats).toMatchObject({ chunks: r.chunks, embedded: true, truncated: false });
    expect(r.preview.startsWith('Section 0')).toBe(true);
    const written = store.chunks.get('f1')!;
    expect(written).toHaveLength(r.chunks);
    expect(written.every((c) => c.embedding !== null)).toBe(true);
    expect(written[0]!.meta.heading).toBe('Section 0');
    expect(texts()[0]!.startsWith('Conditions de vente > Section 0\n')).toBe(true);
  });

  it('un PDF : pages dans les repères de chaque passage', async () => {
    const store = new MemorySourceStore();
    const lines = (t: string) => [{ text: t, y: 650 }];
    const pdf = makePdf([lines('Première page : les tarifs de livraison en France.'), lines('Deuxième page : les horaires de l\'atelier lyonnais.')]);
    const r = await ingestFile({ embedder: null, store, wait: noWait }, { id: 'f2', title: 'Catalogue', name: 'catalogue.pdf', bytes: pdf });
    expect(r.stats.pages).toBe(2);
    expect(store.chunks.get('f2')![0]!.meta.pages).toEqual([1, 2]);
  });

  it('sans embedder, les passages sont écrits sans vecteur', async () => {
    const store = new MemorySourceStore();
    const r = await ingestFile({ embedder: null, store, wait: noWait }, { id: 'f3', title: 'Notes', name: 'notes.txt', bytes: Buffer.from(text(2)) });
    expect(r.embedded).toBe(false);
    expect(store.chunks.get('f3')!.every((c) => c.embedding === null)).toBe(true);
  });

  it('un service d’embeddings en panne laisse les passages sans vecteur, sans faire échouer la lecture', async () => {
    const store = new MemorySourceStore();
    const { embedder } = fakeEmbedder({ fail: true });
    const r = await ingestFile({ embedder, store, wait: noWait }, { id: 'f4', title: 'Notes', name: 'notes.txt', bytes: Buffer.from(text(2)) });
    expect(r.embedded).toBe(false);
    expect(r.chunks).toBeGreaterThan(0);
  });

  it('plafonne le nombre de passages et le dit', async () => {
    const store = new MemorySourceStore();
    const big = Array.from({ length: 700 }, (_, i) => `Bloc ${i} ${'x'.repeat(2_300)}`).join('\n\n');
    const r = await ingestFile({ embedder: null, store, wait: noWait }, { id: 'f5', title: 'Gros', name: 'gros.txt', bytes: Buffer.from(big.slice(0, SOURCE_LIMITS.fileBytes)) });
    expect(r.chunks).toBe(SOURCE_LIMITS.maxChunks);
    expect(r.stats.truncated).toBe(true);
    expect(SOURCE_LIMITS.maxChunks).toBeGreaterThan(KB.maxChunksPerItem);
  });

  it('traduit les refus en SourceFailure : type, taille, fichier abîmé, sans texte', async () => {
    const store = new MemorySourceStore();
    const run = (name: string, bytes: Buffer) => ingestFile({ embedder: null, store, wait: noWait }, { id: 'x', title: 'x', name, bytes });
    expect(await failureOf(run('photo.jpg', Buffer.alloc(100, 1)))).toBe('unsupported_type');
    expect(await failureOf(run('gros.txt', Buffer.alloc(SOURCE_LIMITS.fileBytes + 1, 97)))).toBe('too_large');
    expect(await failureOf(run('faux.pdf', Buffer.from('pas un pdf du tout, juste du texte')))).toBe('corrupt');
    expect(await failureOf(run('vide.txt', Buffer.from('   ')))).toBe('no_text');
    expect(await failureOf(run('scan.pdf', makePdf([[], []])))).toBe('no_text');
    expect(store.chunks.size).toBe(0); // rien n'est écrit quand la lecture échoue
  });

  it('un document Word', async () => {
    const store = new MemorySourceStore();
    const body = para('Livraison', { style: 'Heading1' }) + para('Nous livrons en France et en Belgique sous cinq à sept jours ouvrés après fabrication.');
    const styles = '<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>';
    const r = await ingestFile({ embedder: null, store, wait: noWait }, { id: 'f6', title: 'Conditions', name: 'conditions.docx', bytes: makeDocx(body, styles) });
    expect(r.chunks).toBe(1);
    expect(store.chunks.get('f6')![0]!.content).toContain('Nous livrons en France');
    expect(store.chunks.get('f6')![0]!.meta.heading).toBe('Livraison');
  });
});
