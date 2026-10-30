import type { ChunkMeta, KnowledgeChunkInput, SourceErrorCode } from '@postbiz/kb';
import type { SourceStats, SourceStore } from '@postbiz/kb/ingest';
import type { FetchOptions, FetchResponse } from '@postbiz/kb/net';

// Les documents et les sites en mode démonstration : sans stockage, sans worker et sans réseau. Un fichier envoyé est lu tout de suite, pour de vrai (même code que le
// worker) ; un site est remplacé par un site d'exemple que le même code « lit » en quelques secondes. Rien ne sort de ce serveur.

/** Un passage de la démonstration (cherché par les mots : pas de vecteurs). */
export interface DemoChunk {
  itemId: string;
  ord: number;
  content: string;
  heading: string | null;
  meta: ChunkMeta;
  embedded: boolean;
}

/** Les passages de la démonstration vus comme le worker les voit : mêmes règles que les fonctions SQL `knowledge_source_*`. */
export function demoSourceStore(chunks: () => DemoChunk[], replace: (next: DemoChunk[]) => void): SourceStore {
  const toDemo = (itemId: string, from: number, list: KnowledgeChunkInput[]): DemoChunk[] =>
    list.map((c, i) => ({ itemId, ord: from + i, content: c.content, heading: c.meta.heading ?? null, meta: c.meta, embedded: c.embedding !== null }));
  return {
    async replaceAll(itemId, list) {
      replace([...chunks().filter((c) => c.itemId !== itemId), ...toDemo(itemId, 0, list)]);
      return list.length;
    },
    async pages(itemId) {
      const out = new Map<string, { hash: string; chunks: number; embedded: number }>();
      for (const c of chunks().filter((x) => x.itemId === itemId)) {
        if (!c.meta.url) continue;
        const page = out.get(c.meta.url) ?? { hash: c.meta.hash ?? '', chunks: 0, embedded: 0 };
        page.chunks++;
        if (c.embedded) page.embedded++;
        out.set(c.meta.url, page);
      }
      return out;
    },
    async applyPages(itemId, o) {
      const drop = new Set(o.drop);
      const kept = chunks().filter((c) => !(c.itemId === itemId && c.meta.url && drop.has(c.meta.url)));
      const base = Math.max(-1, ...kept.filter((c) => c.itemId === itemId).map((c) => c.ord)) + 1;
      const next = [...kept, ...toDemo(itemId, base, o.chunks)];
      replace(next);
      return next.filter((c) => c.itemId === itemId).length;
    },
    async touch() {},
  };
}

const html = (title: string, body: string, head = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

/** Le nom d'un site d'après son adresse : « www.maison-lune.fr » donne « Maison Lune ». */
export function siteName(host: string): string {
  const base = host.replace(/^www\./, '').split('.')[0] ?? host;
  return base.split(/[-_]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || host;
}

/**
 * Le site d'exemple qui tient lieu de n'importe quel site en démonstration : accueil, livraison, questions fréquentes, contact. Pour essayer les cas d'échec, le nom du site
 * commande : « bloque.… » interdit les robots, « vide.… » n'affiche rien sans JavaScript, « panne.… » répond par une erreur du serveur.
 */
export function demoSite(host: string): Map<string, { status?: number; type?: string; body: string }> {
  const name = siteName(host);
  const nav = '<nav><a href="/">Accueil</a><a href="/livraison">Livraison</a><a href="/faq">Questions fréquentes</a><a href="/contact">Contact</a></nav>';
  const page = (title: string, content: string, footer = '') => html(`${title} · ${name}`, `${nav}<main>${content}</main>${footer}`);
  const pages = new Map<string, { status?: number; type?: string; body: string }>();

  if (host.startsWith('bloque.')) pages.set('/robots.txt', { type: 'text/plain', body: 'User-agent: *\nDisallow: /' });
  if (host.startsWith('vide.')) {
    pages.set('/', { body: '<!doctype html><html><head><title>App</title><script src="/app.js"></script></head><body><div id="root"></div><noscript>Vous devez activer JavaScript pour utiliser ce site.</noscript></body></html>' });
    return pages;
  }
  if (host.startsWith('panne.')) {
    pages.set('/', { status: 503, body: '' });
    return pages;
  }

  pages.set('/', {
    body: page(
      'Accueil',
      `<h1>${name}, mobilier en bois massif</h1><p>Chez ${name}, nous fabriquons des tables, des chaises et des étagères en bois massif, une pièce à la fois, dans notre atelier lyonnais.
      Chaque meuble est dessiné pour durer, et réparé s'il le faut. Nos essences : chêne, noyer et hêtre, toutes issues de forêts gérées durablement.</p>
      <h2>Notre démarche</h2><p>Nous travaillons à la commande : vous choisissez l'essence, la taille et la finition, nous fabriquons en trois à quatre semaines.</p>`,
      `<footer><p>${name} · 12 rue des Lilas, 69001 Lyon · 04 72 00 00 00</p><p>Atelier ouvert au public le samedi de 10 h à 17 h, et sur rendez-vous en semaine.</p></footer>`,
    ),
  });
  pages.set('/livraison', {
    body: page(
      'Livraison',
      `<h1>Livraison et retours</h1><p>Nous livrons en France métropolitaine et en Belgique, cinq à sept jours ouvrés après la fabrication. La livraison est offerte dès 60 euros d'achat en France.</p>
      <h2>Retours</h2><p>Vous disposez de quatorze jours pour renvoyer une pièce non personnalisée. Les meubles fabriqués sur mesure ne sont ni repris ni échangés, sauf défaut de fabrication couvert par notre garantie de cinq ans.</p>`,
    ),
  });
  pages.set('/faq', {
    body: page(
      'Questions fréquentes',
      `<h1>Questions fréquentes</h1>
      <h3>Quel est le délai de fabrication ?</h3><p>Trois à quatre semaines après la validation de votre commande.</p>
      <h3>Quelles finitions proposez-vous ?</h3><p>Huile naturelle ou cire, sans vernis ni solvants.</p>
      <h3>Reprenez-vous mon ancien meuble ?</h3><p>Oui, la reprise est gratuite pour tout achat d'une table.</p>`,
    ),
  });
  pages.set('/contact', {
    body: page(
      'Contact',
      `<h1>Nous contacter</h1><p>Écrivez-nous à <a href="mailto:contact@${host.replace(/^www\./, '')}">contact@${host.replace(/^www\./, '')}</a> ou appelez le <a href="tel:+33472000000">04 72 00 00 00</a>. Nous répondons sous deux jours ouvrés.</p>
      <p>L'atelier est ouvert le samedi de 10 h à 17 h, au 12 rue des Lilas à Lyon.</p>`,
    ),
  });
  return pages;
}

/** Le « réseau » de la démonstration : sert le site d'exemple, quelle que soit l'adresse demandée. */
export function demoFetch(): (url: string | URL, o: FetchOptions) => Promise<FetchResponse> {
  return async (input, o) => {
    const url = new URL(String(input));
    const page = demoSite(url.hostname).get(url.pathname);
    const status = page?.status ?? (page ? 200 : 404);
    const type = page?.type ?? 'text/html';
    if (status >= 200 && status < 300 && o.contentTypes && !o.contentTypes.test(type)) throw new Error('type non admis');
    return { url, status, contentType: type, charset: 'utf-8', headers: {}, body: Buffer.from(status < 300 ? (page?.body ?? '') : ''), truncated: false, redirects: 0 };
  };
}

/** Ce qu'on garde d'une lecture ratée en démonstration. */
export interface DemoFailure {
  code: SourceErrorCode;
  stats?: SourceStats;
}
