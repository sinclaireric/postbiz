import type { Embedder } from '../embed.ts';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Vectorise des textes, par lots de 32, avec trois essais par lot (1 s puis 3 s d'attente). Un lot qui échoue pour de bon laisse ses textes sans vecteur (`null`) :
 * ces passages restent cherchables par leurs mots et seront revectorisés à la prochaine lecture. Sans service d'embeddings, tout est `null`. Ne lève jamais.
 */
export async function embedBatches(
  embedder: Embedder | null,
  texts: string[],
  o: { signal?: AbortSignal; wait?: (ms: number) => Promise<void> } = {},
): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = texts.map(() => null);
  if (!embedder || texts.length === 0) return out;
  const wait = o.wait ?? pause;
  for (let at = 0; at < texts.length; at += 32) {
    const batch = texts.slice(at, at + 32);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (o.signal?.aborted) return out;
      try {
        const vectors = await embedder.embed(batch, o.signal);
        if (vectors.length === batch.length) {
          vectors.forEach((v, i) => {
            out[at + i] = v;
          });
          break;
        }
      } catch (error) {
        console.error('[base de connaissance] vectorisation', error instanceof Error ? error.name : 'erreur inconnue');
      }
      if (attempt < 2) await wait(attempt === 0 ? 1_000 : 3_000);
    }
  }
  return out;
}
