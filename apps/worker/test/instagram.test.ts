import { describe, expect, it, vi } from 'vitest';
import { createInstagramProvider } from '../src/providers/instagram.ts';
import type { ResolvedMedia } from '../src/providers/types.ts';

const img = (id: string, o: Partial<ResolvedMedia> = {}): ResolvedMedia => ({
  id, kind: 'image', name: `${id}.jpg`, mimeType: 'image/jpeg', alt: '', url: `https://signed/${id}.jpg`, jpegUrl: null, thumbnailUrl: null, sizeBytes: 1, width: 1080, height: 1350, durationSeconds: null, ...o,
});
const vid = (id: string, o: Partial<ResolvedMedia> = {}): ResolvedMedia => ({ ...img(id), kind: 'video', mimeType: 'video/mp4', url: `https://signed/${id}.mp4`, durationSeconds: 24, ...o });

type Call = { method: string; url: string; headers: Record<string, string>; body: any };

/** Faux Graph API : crée des conteneurs, les fait « traiter » un nombre de vérifications réglable, publie. */
function graph(o: {
  statusFor?: (containerId: string, check: number) => string;
  createStatus?: number | ((n: number, body: any) => Response | null);
  publish?: () => Response;
  permalink?: 'ok' | 'fail';
  ig?: string;
} = {}) {
  const calls: Call[] = [];
  const checks = new Map<string, number>();
  let created = 0;
  const ig = o.ig ?? 'IG1';
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (method === 'POST' && url.endsWith(`/${ig}/media`)) {
      created++;
      const custom = typeof o.createStatus === 'function' ? o.createStatus(created, body) : null;
      if (custom) return custom;
      if (typeof o.createStatus === 'number') return json({ error: { message: 'boom' } }, o.createStatus);
      return json({ id: `C${created}` });
    }
    if (method === 'POST' && url.endsWith(`/${ig}/media_publish`)) return o.publish ? o.publish() : json({ id: 'M1' });
    const status = /\/(C\d+)\?fields=status_code/.exec(url);
    if (status) {
      const n = (checks.get(status[1]!) ?? 0) + 1;
      checks.set(status[1]!, n);
      return json({ status_code: o.statusFor ? o.statusFor(status[1]!, n) : 'FINISHED', status: 'détail Meta' });
    }
    if (url.includes('fields=permalink')) return o.permalink === 'fail' ? json({}, 500) : json({ permalink: 'https://www.instagram.com/p/ABC/' });
    throw new Error(`appel inattendu : ${method} ${url}`);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, creations: () => calls.filter((c) => c.method === 'POST' && c.url.endsWith(`/${ig}/media`)), checks };
}

const provider = (g: ReturnType<typeof graph>, opts = {}) => createInstagramProvider(g.fetchImpl, {}, { sleep: async () => {}, pollMs: 1000, imageWaitMs: 3000, videoWaitMs: 5000, ...opts });
const run = (p: ReturnType<typeof provider>, media: ResolvedMedia[], o: { content?: string; settings?: Record<string, unknown>; internalId?: string } = {}) =>
  p.publish({ accessToken: 'TOKEN', integration: { id: 'i1', internalId: o.internalId ?? 'IG1', settings: o.settings ?? {} }, posts: [{ id: 'p1', content: o.content ?? 'Légende', media, settings: {} }] });

describe('Instagram : publication d’une image', () => {
  it('crée le conteneur avec la légende, attend, publie, et renvoie l’identifiant et le lien', async () => {
    const g = graph();
    const r = await run(provider(g), [img('a')]);
    expect(r).toEqual([{ releaseId: 'M1', releaseUrl: 'https://www.instagram.com/p/ABC/' }]);
    const [create] = g.creations();
    expect(create!.url).toBe('https://graph.facebook.com/v23.0/IG1/media');
    expect(create!.headers.Authorization).toBe('Bearer TOKEN');
    expect(create!.body).toEqual({ image_url: 'https://signed/a.jpg', caption: 'Légende' });
    const publish = g.calls.find((c) => c.url.endsWith('/media_publish'))!;
    expect(publish.body).toEqual({ creation_id: 'C1' });
    // l'ordre : conteneur, vérification, publication
    const order = g.calls.map((c) => (c.url.endsWith('/media') ? 'create' : c.url.includes('status_code') ? 'check' : c.url.endsWith('media_publish') ? 'publish' : 'link'));
    expect(order).toEqual(['create', 'check', 'publish', 'link']);
  });

  it('utilise la version JPEG d’une image PNG, et le texte alternatif (limité à 1000 caractères)', async () => {
    const g = graph();
    await run(provider(g), [img('a', { mimeType: 'image/png', url: 'https://signed/a.png', jpegUrl: 'https://signed/a-instagram.jpg', alt: ` ${'é'.repeat(1200)} ` })]);
    const body = g.creations()[0]!.body;
    expect(body.image_url).toBe('https://signed/a-instagram.jpg');
    expect([...body.alt_text]).toHaveLength(1000);
  });

  it('refuse une image qui n’est pas en JPEG et n’a pas de version JPEG, avant tout appel réseau', async () => {
    const g = graph();
    await expect(run(provider(g), [img('a', { mimeType: 'image/png', url: 'https://signed/a.png' })])).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('JPEG') });
    expect(g.fetchImpl).not.toHaveBeenCalled();
  });

  it('connexion Instagram Login : graph.instagram.com et l’identifiant du compte des réglages', async () => {
    const g = graph({ ig: 'IGU9' });
    await run(provider(g), [img('a')], { settings: { graph_host: 'graph.instagram.com', ig_user_id: 'IGU9' }, internalId: 'autre' });
    expect(g.creations()[0]!.url).toBe('https://graph.instagram.com/v23.0/IGU9/media');
  });

  it('ne envoie jamais le jeton à un serveur qui n’est pas celui de Meta', async () => {
    const g = graph();
    await run(provider(g), [img('a')], { settings: { graph_host: 'evil.example.com' } });
    expect(g.calls.every((c) => new URL(c.url).hostname === 'graph.facebook.com')).toBe(true);
  });

  it('le lien de la publication est facultatif : un échec ne change pas le résultat', async () => {
    const r = await run(provider(graph({ permalink: 'fail' })), [img('a')]);
    expect(r).toEqual([{ releaseId: 'M1', releaseUrl: null }]);
  });
});

describe('Instagram : vidéo et carrousel', () => {
  it('une vidéo seule devient un Reel, et on attend la fin du traitement', async () => {
    const g = graph({ statusFor: (_id, n) => (n < 3 ? 'IN_PROGRESS' : 'FINISHED') });
    await run(provider(g), [vid('v')]);
    expect(g.creations()[0]!.body).toEqual({ media_type: 'REELS', video_url: 'https://signed/v.mp4', caption: 'Légende', share_to_feed: true });
    expect(g.checks.get('C1')).toBe(3);
    expect(g.calls.some((c) => c.url.endsWith('/media_publish'))).toBe(true);
  });

  it('un carrousel : un conteneur par média sans légende, puis le conteneur du carrousel avec la légende', async () => {
    const g = graph({ statusFor: (id, n) => (id === 'C2' && n < 2 ? 'IN_PROGRESS' : 'FINISHED') });
    const r = await run(provider(g), [img('a', { alt: 'Un salon' }), vid('v'), img('b')]);
    const [c1, c2, c3, parent] = g.creations().map((c) => c.body);
    expect(c1).toEqual({ image_url: 'https://signed/a.jpg', alt_text: 'Un salon', is_carousel_item: true });
    expect(c2).toEqual({ media_type: 'VIDEO', video_url: 'https://signed/v.mp4', is_carousel_item: true });
    expect(c3).toEqual({ image_url: 'https://signed/b.jpg', is_carousel_item: true });
    expect(parent).toEqual({ media_type: 'CAROUSEL', children: 'C1,C2,C3', caption: 'Légende' });
    expect(g.calls.find((c) => c.url.endsWith('/media_publish'))!.body).toEqual({ creation_id: 'C4' });
    expect(r[0]!.releaseId).toBe('M1');
  });
});

describe('Instagram : refus sûrs (rien n’est publié)', () => {
  const noPublish = (g: ReturnType<typeof graph>) => expect(g.calls.some((c) => c.url.endsWith('/media_publish'))).toBe(false);

  it('un conteneur en erreur arrête tout, avec le détail de Meta', async () => {
    const g = graph({ statusFor: () => 'ERROR' });
    await expect(run(provider(g), [vid('v')])).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('détail Meta') });
    noPublish(g);
  });

  it('un traitement trop long est un refus, pas une issue incertaine', async () => {
    const g = graph({ statusFor: () => 'IN_PROGRESS' });
    await expect(run(provider(g), [vid('v')])).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('trop de temps') });
    noPublish(g);
  });

  it('une panne (5xx) à la création du conteneur n’est pas une issue incertaine : on peut reprogrammer', async () => {
    const g = graph({ createStatus: 500 });
    await expect(run(provider(g), [img('a')])).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('Rien n’a été publié') });
    noPublish(g);
  });

  it('une coupure réseau pendant la vérification est tolérée, puis abandonnée si elle dure', async () => {
    let n = 0;
    const g = graph();
    const flaky = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('status_code') && ++n <= 2) throw new TypeError('réseau coupé');
      return g.fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const ok = await createInstagramProvider(flaky, {}, { sleep: async () => {}, pollMs: 1000, imageWaitMs: 5000 }).publish({ accessToken: 'T', integration: { id: 'i', internalId: 'IG1', settings: {} }, posts: [{ id: 'p', content: 'x', media: [img('a')], settings: {} }] });
    expect(ok[0]!.releaseId).toBe('M1');

    const dead = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('status_code')) throw new TypeError('réseau coupé');
      return graph().fetchImpl(input, init);
    }) as unknown as typeof fetch;
    await expect(createInstagramProvider(dead, {}, { sleep: async () => {}, pollMs: 1000, imageWaitMs: 5000 }).publish({ accessToken: 'T', integration: { id: 'i', internalId: 'IG1', settings: {} }, posts: [{ id: 'p', content: 'x', media: [img('a')], settings: {} }] }))
      .rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('ne répond plus') });
  });

  it('refuse sans appel réseau : aucun média, plus de 10 médias, légende trop longue', async () => {
    const g = graph();
    await expect(run(provider(g), [])).rejects.toMatchObject({ message: expect.stringContaining('au moins une image') });
    await expect(run(provider(g), Array.from({ length: 11 }, (_, i) => img(`m${i}`)))).rejects.toMatchObject({ message: expect.stringContaining('10 médias') });
    await expect(run(provider(g), [img('a')], { content: 'é'.repeat(2201) })).rejects.toMatchObject({ message: expect.stringContaining('2200') });
    expect(g.fetchImpl).not.toHaveBeenCalled();
  });

  it('un jeton refusé par Meta (code 190) demande de reconnecter le canal', async () => {
    const g = graph({ createStatus: () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token.' } }), { status: 400 }) });
    await expect(run(provider(g), [img('a')])).rejects.toMatchObject({ name: 'ReconnectRequiredError' });
  });

  it('un refus clair de Meta à la création est rapporté tel quel', async () => {
    const g = graph({ createStatus: () => new Response(JSON.stringify({ error: { code: 9004, message: 'Impossible de télécharger le média' } }), { status: 400 }) });
    await expect(run(provider(g), [img('a')])).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('Impossible de télécharger') });
  });
});

describe('Instagram : la publication elle-même n’est jamais rejouée', () => {
  it('une panne à media_publish laisse une issue incertaine (à vérifier sur le compte), jamais un refus', async () => {
    const g = graph({ publish: () => new Response('{}', { status: 502 }) });
    await expect(run(provider(g), [img('a')])).rejects.toMatchObject({ name: 'OutcomeUnknownError' });
    expect(g.calls.filter((c) => c.url.endsWith('/media_publish'))).toHaveLength(1);
  });

  it('une réponse sans identifiant est aussi une issue incertaine', async () => {
    const g = graph({ publish: () => new Response('{}', { status: 200 }) });
    await expect(run(provider(g), [img('a')])).rejects.toMatchObject({ name: 'OutcomeUnknownError' });
  });

  it('un refus clair à media_publish reste un refus', async () => {
    const g = graph({ publish: () => new Response(JSON.stringify({ error: { code: 9007, message: 'Le média n’est pas prêt' } }), { status: 400 }) });
    await expect(run(provider(g), [img('a')])).rejects.toMatchObject({ name: 'PublishRejectedError' });
  });
});
