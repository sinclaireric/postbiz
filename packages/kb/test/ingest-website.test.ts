import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SOURCE_LIMITS } from '../src/constants.ts';
import { FetchError } from '../src/net/fetch.ts';
import { MemorySourceStore, SourceFailure, syncWebsite, type SiteDeps, type SiteJob } from '../src/ingest/index.ts';
import { content, fakeClock, fakeEmbedder, fakeSite, htmlPage, words, type FakePage } from './helpers/fake-site.ts';

const UA = 'PostbizBot/1.0 (+https://postbiz.example)';
const H = 'https://exemple.fr';

interface Run {
  pages: Record<string, FakePage | string>;
  job?: Partial<SiteJob>;
  store?: MemorySourceStore;
  embedder?: ReturnType<typeof fakeEmbedder> | null;
  deps?: Partial<SiteDeps>;
}

async function run({ pages, job = {}, store = new MemorySourceStore(), embedder = fakeEmbedder(), deps = {} }: Run) {
  const clock = fakeClock();
  const site = fakeSite(pages, clock);
  const result = await syncWebsite(
    { embedder: embedder?.embedder ?? null, store, userAgent: UA, fetch: site.fetch, sleep: clock.sleep, now: clock.now, ...deps },
    { id: 's1', title: 'exemple.fr', url: `${H}/`, scope: 'site', ...job },
  );
  return { result, store, site, clock, embedder };
}
const failureOf = async (r: Run) => {
  try {
    await run(r);
    return 'aucune erreur';
  } catch (e) {
    return e instanceof SourceFailure ? `${e.code}${e.transient ? ' (passagère)' : ''}` : e instanceof FetchError ? `réseau : ${e.code}` : `autre : ${(e as Error).message}`;
  }
};
const urlsOf = (store: MemorySourceStore, id = 's1') => [...new Set((store.chunks.get(id) ?? []).map((c) => c.meta.url))];

const home = (links: string[], extra = '') =>
  htmlPage('Maison Lune', `<nav>${links.map((l) => `<a href="${l}">${l}</a>`).join('')}</nav><main><h1>Accueil</h1><p>${words(40)}</p></main>${extra}`);

describe('syncWebsite : une page', () => {
  it('lit la page, la découpe, la vectorise et écrit ses passages avec leurs repères', async () => {
    const { result, store, site } = await run({ pages: { [`${H}/`]: content('Accueil') }, job: { scope: 'page' } });
    expect(site.requests).toEqual([`${H}/robots.txt`, `${H}/`]);
    expect(result.stats).toMatchObject({ fetched: 1, changed: 1, unchanged: 0, failed: 0, total: 1, chunks: 1, embedded: true });
    expect(result.preview).toContain('Accueil');
    const [chunk] = store.chunks.get('s1')!;
    expect(chunk!.meta).toMatchObject({ url: `${H}/`, title: 'Accueil', heading: 'Accueil' });
    expect(chunk!.meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(chunk!.embedding).not.toBeNull();
  });

  it('ne suit aucun lien en mode « page seule »', async () => {
    const { site } = await run({ pages: { [`${H}/`]: home(['/livraison']), [`${H}/livraison`]: content('Livraison') }, job: { scope: 'page' } });
    expect(site.requests).toEqual([`${H}/robots.txt`, `${H}/`]);
  });
});

describe('syncWebsite : tout le site', () => {
  const site = {
    [`${H}/`]: home(['/livraison', '/contact', 'https://autre.fr/x', '/photo.jpg', '/wp-admin/', '/panier', '#haut', 'mailto:a@b.fr', '/livraison?utm_source=x']),
    [`${H}/livraison`]: content('Livraison'),
    [`${H}/contact`]: content('Contact'),
    [`${H}/faq`]: content('Questions fréquentes'),
    [`${H}/robots.txt`]: { type: 'text/plain', body: `User-agent: *\nDisallow: /prive\nSitemap: ${H}/plan.xml` },
    [`${H}/plan.xml`]: { type: 'application/xml', body: `<urlset><url><loc>${H}/faq</loc></url><url><loc>${H}/livraison</loc></url><url><loc>${H}/prive/secret</loc></url><url><loc>https://autre.fr/y</loc></url></urlset>` },
    [`${H}/prive/secret`]: content('Secret'),
  };

  it('lit la page demandée, ses liens (menu), puis le plan du site ; jamais un autre site, un fichier, l’administration ni le panier', async () => {
    const { site: s, store, result } = await run({ pages: site });
    expect(s.requests).toEqual([`${H}/robots.txt`, `${H}/`, `${H}/plan.xml`, `${H}/livraison`, `${H}/contact`, `${H}/faq`]);
    expect(urlsOf(store)).toEqual([`${H}/`, `${H}/livraison`, `${H}/contact`, `${H}/faq`]);
    expect(result.stats).toMatchObject({ fetched: 4, changed: 4, robots: 1, total: 4 });
  });

  it('respecte le robots.txt : les pages interdites ne sont pas lues (et comptées)', async () => {
    const { site: s, result } = await run({ pages: site });
    expect(s.requests).not.toContain(`${H}/prive/secret`);
    expect(result.stats.robots).toBe(1);
  });

  it('plafonne le nombre de pages lues et marque la source tronquée', async () => {
    const { result, store } = await run({ pages: site, job: { maxPages: 2 } });
    expect(result.stats).toMatchObject({ fetched: 2, truncated: true });
    expect(urlsOf(store)).toEqual([`${H}/`, `${H}/livraison`]);
    const all = await run({ pages: site, job: { maxPages: 500 } });
    expect(all.result.stats.fetched).toBe(4); // jamais plus que le plafond du produit, ici le site n'a que 4 pages
    expect(all.result.stats.truncated).toBeUndefined();
  });

  it('lit le pied de page et les données de l’entreprise de la page d’accueil seulement', async () => {
    const ld = JSON.stringify({ '@type': 'FurnitureStore', name: 'Maison Lune', telephone: '04 72 00 00 00', address: { streetAddress: '12 rue des Lilas', addressLocality: 'Lyon' } });
    const withFooter = (title: string) => htmlPage(title, `<main><h1>${title}</h1><p>${words(40)}</p></main><footer><p>Adresse : 12 rue des Lilas à Lyon, ouvert le samedi.</p></footer>`, `<script type="application/ld+json">${ld}</script>`);
    const { store } = await run({ pages: { [`${H}/`]: withFooter('Accueil').replace('<main>', '<nav><a href="/a">a</a></nav><main>'), [`${H}/a`]: withFooter('Autre page') } });
    const texts = Object.fromEntries([...new Set((store.chunks.get('s1') ?? []).map((c) => c.meta.url!))].map((u) => [u, (store.chunks.get('s1') ?? []).filter((c) => c.meta.url === u).map((c) => c.content).join('\n')]));
    expect(texts[`${H}/`]).toContain('ouvert le samedi');
    expect(texts[`${H}/`]).toContain('04 72 00 00 00');
    expect(texts[`${H}/a`]).not.toContain('ouvert le samedi');
    expect(texts[`${H}/a`]).not.toContain('04 72 00 00 00');
  });

  it('suit le plan du site déclaré en index, et lit un plan compressé (.xml.gz) ; les pages peu profondes d’abord', async () => {
    const index = `<sitemapindex><sitemap><loc>${H}/pages.xml.gz</loc></sitemap></sitemapindex>`;
    const pages = `<urlset><url><loc>${H}/a/b/c</loc></url><url><loc>${H}/z</loc></url><url><loc>${H}/a</loc></url></urlset>`;
    const { site: s } = await run({
      pages: {
        [`${H}/`]: content('Accueil'),
        [`${H}/sitemap.xml`]: { type: 'application/xml', body: index },
        [`${H}/pages.xml.gz`]: { type: 'application/gzip', body: zlib.gzipSync(pages) },
        [`${H}/a/b/c`]: content('Profonde'),
        [`${H}/z`]: content('Z'),
        [`${H}/a`]: content('A'),
      },
    });
    expect(s.requests.filter((r) => /\/(a|z|a\/b\/c)$/.test(r))).toEqual([`${H}/z`, `${H}/a`, `${H}/a/b/c`]);
  });

  it('une page qui redirige hors du site est ignorée ; deux adresses de la même page (canonique, paramètre) ne la gardent qu’une fois', async () => {
    const { store, result } = await run({
      pages: {
        [`${H}/`]: home(['/produit?couleur=bleu', '/produit', '/ailleurs', '/accueil-faux']),
        [`${H}/produit?couleur=bleu`]: htmlPage('Produit', `<main><p>${words(40)}</p></main>`, `<link rel="canonical" href="${H}/produit">`),
        [`${H}/produit`]: content('Produit'),
        [`${H}/ailleurs`]: { location: 'https://autre.fr/page' },
        [`https://autre.fr/page`]: content('Autre site'),
        // Une adresse canonique qui désigne une autre page (l'accueil) n'est pas crue : la page est gardée pour elle-même.
        [`${H}/accueil-faux`]: htmlPage('Faux canonique', `<main><p>${words(40, 'unique')}</p></main>`, `<link rel="canonical" href="${H}/">`),
      },
    });
    expect(urlsOf(store).sort()).toEqual([`${H}/`, `${H}/accueil-faux`, `${H}/produit`].sort());
    expect(result.stats.fetched).toBe(4);
  });

  it('adopte l’adresse où la page demandée aboutit (domaine nu vers www, http vers https), avec son propre robots.txt', async () => {
    const www = 'https://www.exemple.fr';
    const { store, site: s } = await run({
      pages: {
        [`${H}/`]: { location: `${www}/` },
        [`${www}/`]: home(['/livraison']),
        [`${www}/livraison`]: content('Livraison'),
        [`${www}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /nulle-part' },
      },
    });
    expect(urlsOf(store)).toEqual([`${www}/`, `${www}/livraison`]);
    expect(s.requests).toContain(`${www}/robots.txt`);
  });

  it('une page du site qui échoue (délai dépassé, erreur 500) est comptée sans arrêter la lecture', async () => {
    const { result, store } = await run({
      pages: { [`${H}/`]: home(['/lente', '/cassee', '/bonne']), [`${H}/lente`]: { error: 'timeout' }, [`${H}/cassee`]: { status: 500 }, [`${H}/bonne`]: content('Bonne') },
    });
    expect(result.stats).toMatchObject({ failed: 2, fetched: 2, total: 2 });
    expect(urlsOf(store)).toEqual([`${H}/`, `${H}/bonne`]);
  });

  it('un site fait de petits textes de peu d’intérêt : les pages sans texte lisible ne sont pas gardées', async () => {
    const { store } = await run({ pages: { [`${H}/`]: home(['/vide']), [`${H}/vide`]: htmlPage('Vide', '<main><p>Ok.</p></main>') } });
    expect(urlsOf(store)).toEqual([`${H}/`]);
  });

  it('une page qui n’est pas du HTML (un PDF lié) est ignorée sans compter comme une panne', async () => {
    const { result } = await run({ pages: { [`${H}/`]: home(['/doc']), [`${H}/doc`]: { type: 'application/pdf', body: '%PDF-1.4' } } });
    expect(result.stats.failed).toBe(0);
    expect(result.stats.fetched).toBe(1);
  });
});

describe('syncWebsite : politesse et robots.txt', () => {
  it('espace les requêtes d’au moins le délai demandé par le site (Crawl-delay), et d’au moins 700 ms sinon', async () => {
    const pages = { [`${H}/`]: home(['/a', '/b']), [`${H}/a`]: content('A'), [`${H}/b`]: content('B') };
    const normal = await run({ pages });
    const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]!);
    expect(Math.min(...gaps(normal.site.times))).toBeGreaterThanOrEqual(700);
    const slow = await run({ pages: { ...pages, [`${H}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nCrawl-delay: 3' } } });
    expect(Math.min(...gaps(slow.site.times.slice(1)))).toBeGreaterThanOrEqual(3_000);
    const capped = await run({ pages: { ...pages, [`${H}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nCrawl-delay: 3600' } } });
    expect(Math.max(...gaps(capped.site.times))).toBeLessThanOrEqual(10_200);
  });

  it('refuse la page demandée si le robots.txt l’interdit, y compris par un groupe qui nomme notre robot', async () => {
    const pages = (robots: string) => ({ [`${H}/`]: content('Accueil'), [`${H}/robots.txt`]: { type: 'text/plain', body: robots } });
    expect(await failureOf({ pages: pages('User-agent: *\nDisallow: /') })).toBe('robots_disallowed');
    expect(await failureOf({ pages: pages('User-agent: PostbizBot\nDisallow: /\n\nUser-agent: *\nAllow: /') })).toBe('robots_disallowed');
    expect(await failureOf({ pages: pages('User-agent: Googlebot\nDisallow: /') })).toBe('aucune erreur');
    expect(await failureOf({ pages: pages('User-agent: PostbizBot\nAllow: /\n\nUser-agent: *\nDisallow: /') })).toBe('aucune erreur');
  });

  it('un robots.txt en erreur 5xx ou 429 arrête la lecture (à réessayer) ; une réponse 4xx veut dire « pas de règles »', async () => {
    const pages = (status: number) => ({ [`${H}/`]: content('Accueil'), [`${H}/robots.txt`]: { status } });
    expect(await failureOf({ pages: pages(503) })).toBe('http_error (passagère)');
    expect(await failureOf({ pages: pages(429) })).toBe('http_error (passagère)');
    expect(await failureOf({ pages: pages(403) })).toBe('aucune erreur');
    expect(await failureOf({ pages: pages(404) })).toBe('aucune erreur');
  });

  it('s’annonce avec son User-Agent', async () => {
    const { site } = await run({ pages: { [`${H}/`]: content('Accueil') }, job: { scope: 'page' } });
    expect(site.fetch.mock.calls.every(([, o]) => o.userAgent === UA)).toBe(true);
  });
});

describe('syncWebsite : pannes de la page demandée', () => {
  const start = (page: FakePage | string) => ({ [`${H}/`]: page });

  it('traduit le refus ou la panne du site', async () => {
    expect(await failureOf({ pages: start({ status: 404 }), job: { scope: 'page' } })).toBe('http_error');
    expect(await failureOf({ pages: start({ status: 410 }), job: { scope: 'page' } })).toBe('http_error');
    expect(await failureOf({ pages: start({ status: 403 }), job: { scope: 'page' } })).toBe('http_error');
    expect(await failureOf({ pages: start({ status: 500 }), job: { scope: 'page' } })).toBe('http_error (passagère)');
    expect(await failureOf({ pages: start({ status: 429 }), job: { scope: 'page' } })).toBe('http_error (passagère)');
  });

  it('traduit les erreurs réseau : passagères ou non', async () => {
    for (const [error, expected] of [['timeout', 'timeout (passagère)'], ['unreachable', 'unreachable (passagère)'], ['dns_failed', 'dns_failed (passagère)'], ['tls_error', 'tls_error (passagère)'],
      ['blocked_address', 'blocked_address'], ['invalid_url', 'invalid_url'], ['redirect_loop', 'redirect_loop'], ['not_html', 'not_html']] as const) {
      expect(await failureOf({ pages: start({ error }), job: { scope: 'page' } }), error).toBe(expected);
    }
  });

  it('une page qui n’est pas du HTML est refusée', async () => {
    expect(await failureOf({ pages: start({ type: 'application/pdf', body: '%PDF' }), job: { scope: 'page' } })).toBe('not_html');
  });

  it('une adresse refusée d’emblée : réseau local, schéma, nom interne', async () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/', 'https://localhost/', 'https://intranet/', 'https://x.internal/']) expect(await failureOf({ pages: {}, job: { url } }), url).toBe('blocked_address');
    for (const url of ['ftp://exemple.fr/', 'file:///etc/passwd', 'pas une adresse', 'https://u:p@exemple.fr/', 'https://exemple.fr:8080/']) expect(await failureOf({ pages: {}, job: { url } }), url).toBe('invalid_url');
  });

  it('un site qui n’affiche rien sans JavaScript donne empty_site, et le dit dans les chiffres', async () => {
    const spa = '<html><head><title>App</title><script src="/a.js"></script></head><body><div id="root"></div><noscript>Activez JavaScript.</noscript></body></html>';
    try {
      await run({ pages: start(spa) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SourceFailure);
      expect((e as SourceFailure).code).toBe('empty_site');
      expect((e as SourceFailure).stats).toMatchObject({ spa: 1 });
    }
  });

  it('une page de départ dont les autres pages sont toutes en panne ne donne rien d’écrit', async () => {
    expect(await failureOf({ pages: { [`${H}/`]: home(['/a']), [`${H}/a`]: { error: 'timeout' } } })).toBe('aucune erreur'); // la page d'accueil a du texte
  });

  it('annulée, la lecture s’arrête avec l’erreur d’annulation', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await failureOf({ pages: start(content('Accueil')), deps: { signal: controller.signal } })).toBe('réseau : aborted');
  });
});

describe('syncWebsite : relectures', () => {
  const pages = (over: Record<string, FakePage | string> = {}): Record<string, FakePage | string> => ({
    [`${H}/`]: home(['/livraison', '/contact']),
    [`${H}/livraison`]: content('Livraison', `Nous livrons en France. ${words(30)}`),
    [`${H}/contact`]: content('Contact', `Écrivez-nous. ${words(30, 'mot')}`),
    ...over,
  });

  it('une relecture identique ne revectorise rien et ne touche à aucun passage', async () => {
    const first = await run({ pages: pages() });
    const before = JSON.stringify(first.store.chunks.get('s1'));
    const embedder = fakeEmbedder();
    const second = await run({ pages: pages(), store: first.store, embedder });
    expect(second.result.stats).toMatchObject({ unchanged: 3, changed: 0, removed: 0, total: 3 });
    expect(embedder.embedder.embed).not.toHaveBeenCalled();
    expect(JSON.stringify(first.store.chunks.get('s1'))).toBe(before);
  });

  it('une page modifiée est seule revectorisée, et remplace ses anciens passages', async () => {
    const first = await run({ pages: pages() });
    const embedder = fakeEmbedder();
    const second = await run({ pages: pages({ [`${H}/livraison`]: content('Livraison', `Nous livrons désormais partout en Europe. ${words(30)}`) }), store: first.store, embedder });
    expect(second.result.stats).toMatchObject({ unchanged: 2, changed: 1, total: 3 });
    expect(embedder.texts()).toHaveLength(1);
    expect(embedder.texts()[0]).toContain('partout en Europe');
    const livraison = first.store.chunks.get('s1')!.filter((c) => c.meta.url === `${H}/livraison`);
    expect(livraison).toHaveLength(1);
    expect(livraison[0]!.content).toContain('partout en Europe');
    expect(urlsOf(first.store)).toHaveLength(3);
  });

  it('une page devenue introuvable (404) est retirée', async () => {
    const first = await run({ pages: pages() });
    const second = await run({ pages: pages({ [`${H}/contact`]: { status: 404 } }), store: first.store });
    expect(second.result.stats).toMatchObject({ removed: 1, unchanged: 2, total: 2 });
    expect(urlsOf(first.store)).toEqual([`${H}/`, `${H}/livraison`]);
    expect(second.result.chunks).toBe(first.store.chunks.get('s1')!.length);
  });

  it('lecture complète : une page qui n’est plus liée du tout est retirée ; lecture partielle : elle reste', async () => {
    const first = await run({ pages: pages() });
    const unlinked = pages({ [`${H}/`]: home(['/livraison']) }); // /contact existe encore mais n'est plus lié
    const partial = await run({ pages: unlinked, store: first.store, job: { maxPages: 1 } });
    expect(partial.result.stats.removed).toBe(0);
    expect(urlsOf(first.store)).toHaveLength(3);
    const complete = await run({ pages: unlinked, store: first.store });
    expect(complete.result.stats.removed).toBe(1);
    expect(urlsOf(first.store)).toEqual([`${H}/`, `${H}/livraison`]);
  });

  it('une page en panne passagère garde son ancien contenu', async () => {
    const first = await run({ pages: pages() });
    const second = await run({ pages: pages({ [`${H}/contact`]: { error: 'timeout' } }), store: first.store });
    expect(second.result.stats).toMatchObject({ failed: 1, removed: 0 });
    expect(urlsOf(first.store)).toHaveLength(3);
  });

  it('la lecture qui tombe sur un site vide ne détruit pas ce qui était déjà lu', async () => {
    const first = await run({ pages: pages() });
    const chunks = first.store.chunks.get('s1')!.length;
    expect(await failureOf({ pages: { [`${H}/`]: htmlPage('Maintenance', '<main><p>Site en maintenance.</p></main>') }, store: first.store })).toBe('empty_site');
    expect(first.store.chunks.get('s1')!.length).toBe(chunks);
  });

  it('passages sans vecteur (service en panne) : écrits sans vecteur, puis vectorisés à la lecture suivante même si le texte n’a pas changé', async () => {
    const broken = fakeEmbedder({ fail: true });
    const first = await run({ pages: pages(), embedder: broken });
    expect(first.result.embedded).toBe(false);
    expect(first.store.chunks.get('s1')!.every((c) => c.embedding === null)).toBe(true);

    const none = await run({ pages: pages(), store: first.store, embedder: null });
    expect(none.result.stats).toMatchObject({ unchanged: 3, changed: 0, embedded: false });

    const working = fakeEmbedder();
    const second = await run({ pages: pages(), store: first.store, embedder: working });
    expect(second.result.stats).toMatchObject({ changed: 3, embedded: true });
    expect(first.store.chunks.get('s1')!.every((c) => c.embedding !== null)).toBe(true);
  });
});

describe('syncWebsite : limites', () => {
  it('plafonne les passages de la source (400) et marque la source tronquée', async () => {
    const big = (n: number) => htmlPage(`Page ${n}`, `<main><h1>Page ${n}</h1>${Array.from({ length: 20 }, (_, i) => `<p>${words(180, `p${n}m${i}x`)}</p>`).join('')}</main>`);
    const links = Array.from({ length: 49 }, (_, i) => `/p${i + 1}`);
    const pages: Record<string, FakePage | string> = { [`${H}/`]: home(links) };
    links.forEach((l, i) => { pages[`${H}${l}`] = big(i + 1); });
    const { result, store } = await run({ pages });
    expect(result.chunks).toBeLessThanOrEqual(SOURCE_LIMITS.maxChunks);
    expect(store.chunks.get('s1')!.length).toBe(result.chunks);
    expect(result.stats.truncated).toBe(true);
    expect(result.stats.fetched).toBeLessThan(50);
  });

  it('s’arrête à la durée maximale, sans rien retirer de ce qu’on n’a pas pu relire', async () => {
    const many: Record<string, FakePage | string> = { [`${H}/`]: home(Array.from({ length: 20 }, (_, i) => `/p${i}`)) };
    for (let i = 0; i < 20; i++) many[`${H}/p${i}`] = content(`Page ${i}`);
    const first = await run({ pages: many });
    expect(first.result.stats.fetched).toBe(21 > 50 ? 50 : 21);
    const second = await run({ pages: many, store: first.store, deps: { crawlSeconds: 3 } });
    expect(second.result.stats.timeLimit).toBe(true);
    expect(second.result.stats.removed).toBe(0);
    expect(urlsOf(first.store)).toHaveLength(21);
  });

  it('prolonge le verrou pendant une lecture longue', async () => {
    const many: Record<string, FakePage | string> = { [`${H}/`]: home(Array.from({ length: 12 }, (_, i) => `/p${i}`)) };
    for (let i = 0; i < 12; i++) many[`${H}/p${i}`] = content(`Page ${i}`);
    const { store } = await run({ pages: many });
    expect(store.touches).toBeGreaterThan(0);
  });
});
