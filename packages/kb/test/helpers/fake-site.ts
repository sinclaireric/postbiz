import { vi } from 'vitest';
import type { Embedder } from '../../src/embed.ts';
import { FetchError, type FetchOptions, type FetchResponse } from '../../src/net/fetch.ts';

export interface FakePage {
  status?: number;
  /** Type de contenu complet (par défaut « text/html; charset=utf-8 »). */
  type?: string;
  body?: string | Buffer;
  location?: string;
  /** Fait lever cette erreur réseau au lieu de répondre. */
  error?: FetchError['code'];
}

/** Un site simulé : une table adresse → réponse. Une adresse inconnue répond 404. Rend aussi la liste des requêtes reçues. */
export function fakeSite(pages: Record<string, FakePage | string>, clock?: { now(): number; advance(ms: number): void }) {
  const table = new Map<string, FakePage>();
  for (const [href, page] of Object.entries(pages)) table.set(new URL(href).href, typeof page === 'string' ? { body: page } : page);
  const requests: string[] = [];
  /** L'heure (de l'horloge simulée) de chaque requête. */
  const times: number[] = [];

  const fetch = vi.fn(async (input: string | URL, o: FetchOptions): Promise<FetchResponse> => {
    let url = new URL(String(input));
    for (let hop = 0; hop <= 5; hop++) {
      requests.push(url.href);
      times.push(clock?.now() ?? 0);
      clock?.advance(200);
      const page = table.get(url.href) ?? { status: 404, body: '<html><body>Introuvable</body></html>' };
      if (page.error) throw new FetchError(page.error);
      if (page.location) {
        url = new URL(page.location, url);
        continue;
      }
      const status = page.status ?? 200;
      const type = page.type ?? 'text/html; charset=utf-8';
      const mime = type.split(';')[0]!.trim().toLowerCase();
      if (status >= 200 && status < 300 && o.contentTypes && !o.contentTypes.test(mime)) throw new FetchError('not_html', mime);
      const body = status >= 200 && status < 300 ? (Buffer.isBuffer(page.body) ? page.body : Buffer.from(page.body ?? '')) : Buffer.alloc(0);
      return { url, status, contentType: mime, charset: /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase() ?? null, headers: {}, body, truncated: false, redirects: hop };
    }
    throw new FetchError('redirect_loop');
  });
  return { fetch, requests, times, table };
}

/** Une page HTML avec assez de texte pour être gardée. */
export const htmlPage = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
export const words = (n: number, w = 'atelier') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
export const content = (title: string, text = `Voici le contenu utile de la page ${title}, avec assez de mots pour être gardé dans la base de connaissance.`) =>
  htmlPage(title, `<main><h1>${title}</h1><p>${text}</p></main>`);

/** Une horloge simulée : `sleep` et les requêtes la font avancer ; rien n'attend pour de bon. */
export function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; }, sleep: vi.fn(async (ms: number) => { t += ms; }) };
}

/** Un service d'embeddings simulé : un vecteur d'un nombre par texte ; `fail` fait échouer les appels. */
export function fakeEmbedder(o: { fail?: boolean } = {}) {
  const calls: string[][] = [];
  const state = { fail: o.fail ?? false };
  const embedder: Embedder = {
    embed: vi.fn(async (texts: string[]) => {
      calls.push(texts);
      if (state.fail) throw new Error('service indisponible');
      return texts.map((t) => [t.length, 1, 0]);
    }),
  };
  return { embedder, calls, state, texts: () => calls.flat() };
}
