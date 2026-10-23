import { describe, expect, it, vi } from 'vitest';
import { createFacebookProvider } from '../src/providers/facebook.ts';
import type { ResolvedMedia } from '../src/providers/types.ts';

const photo = (id: string, o: Partial<ResolvedMedia> = {}): ResolvedMedia => ({
  id, kind: 'image', name: `${id}.jpg`, mimeType: 'image/jpeg', alt: '', url: `https://signed/${id}.jpg`, jpegUrl: null, thumbnailUrl: null, sizeBytes: 1, width: 1, height: 1, durationSeconds: null, ...o,
});
const video = (id: string): ResolvedMedia => ({ ...photo(id), kind: 'video', mimeType: 'video/mp4', url: `https://signed/${id}.mp4` });

type Call = { url: string; body: any; headers: Record<string, string> };
function graph(reply: (call: Call, n: number) => Response | null = () => null) {
  const calls: Call[] = [];
  let n = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body ?? '{}')), headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    n++;
    const custom = reply(call, n);
    if (custom) return custom;
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (call.url.endsWith('/PAGE1/photos')) return json(call.body.published === false ? { id: `PH${n}` } : { id: 'PHOTO9', post_id: 'PAGE1_777' });
    if (call.url.endsWith('/PAGE1/feed')) return json({ id: 'PAGE1_555' });
    if (call.url.endsWith('/PAGE1/videos')) return json({ id: 'VID1' });
    throw new Error(`appel inattendu : ${call.url}`);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}
const run = (g: ReturnType<typeof graph>, media: ResolvedMedia[], content = 'Bonjour') =>
  createFacebookProvider(g.fetchImpl).publish({ accessToken: 'TOKEN', integration: { id: 'i', internalId: 'PAGE1', settings: {} }, posts: [{ id: 'p', content, media, settings: {} }] });

describe('Facebook : publication avec médias', () => {
  it('sans média : un post texte sur /feed, comme avant', async () => {
    const g = graph();
    const r = await run(g, []);
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]).toMatchObject({ url: 'https://graph.facebook.com/v23.0/PAGE1/feed', body: { message: 'Bonjour' } });
    expect(r[0]).toMatchObject({ releaseId: 'PAGE1_555' });
  });

  it('une photo : un seul appel /photos publié avec sa légende et son texte alternatif ; l’identifiant est celui du post', async () => {
    const g = graph();
    const r = await run(g, [photo('a', { alt: 'Un canapé' })], 'Légende');
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.url).toBe('https://graph.facebook.com/v23.0/PAGE1/photos');
    expect(g.calls[0]!.body).toEqual({ url: 'https://signed/a.jpg', caption: 'Légende', published: true, alt_text_custom: 'Un canapé' });
    expect(g.calls[0]!.headers.Authorization).toBe('Bearer TOKEN');
    expect(r).toEqual([{ releaseId: 'PAGE1_777', releaseUrl: 'https://www.facebook.com/PAGE1_777' }]); // post_id, pas l'identifiant de la photo (sinon le premier commentaire irait au mauvais endroit)
  });

  it('plusieurs photos : chacune est envoyée sans être publiée, dans l’ordre, puis un seul post les rassemble', async () => {
    const g = graph();
    const r = await run(g, [photo('a'), photo('b', { alt: 'Détail' }), photo('c')]);
    const [p1, p2, p3, feed] = g.calls;
    expect([p1, p2, p3].map((c) => c!.body)).toEqual([
      { url: 'https://signed/a.jpg', published: false },
      { url: 'https://signed/b.jpg', published: false, alt_text_custom: 'Détail' },
      { url: 'https://signed/c.jpg', published: false },
    ]);
    expect(feed!.url).toBe('https://graph.facebook.com/v23.0/PAGE1/feed');
    expect(feed!.body).toEqual({ message: 'Bonjour', attached_media: [{ media_fbid: 'PH1' }, { media_fbid: 'PH2' }, { media_fbid: 'PH3' }] });
    expect(r[0]!.releaseId).toBe('PAGE1_555');
  });

  it('une vidéo : /videos sur graph-video avec l’adresse du fichier et la description', async () => {
    const g = graph();
    const r = await run(g, [video('v')], 'Visite');
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]).toMatchObject({ url: 'https://graph-video.facebook.com/v23.0/PAGE1/videos', body: { file_url: 'https://signed/v.mp4', description: 'Visite' } });
    expect(r).toEqual([{ releaseId: 'VID1', releaseUrl: 'https://www.facebook.com/VID1' }]);
  });

  it('refuse sans appel réseau : plus de 10 photos, deux vidéos, photos et vidéo mélangées', async () => {
    const g = graph();
    await expect(run(g, Array.from({ length: 11 }, (_, i) => photo(`p${i}`)))).rejects.toMatchObject({ name: 'PublishRejectedError' });
    await expect(run(g, [video('a'), video('b')])).rejects.toMatchObject({ name: 'PublishRejectedError' });
    await expect(run(g, [photo('a'), video('b')])).rejects.toMatchObject({ name: 'PublishRejectedError' });
    expect(g.fetchImpl).not.toHaveBeenCalled();
  });

  it('une panne pendant l’envoi des photos non publiées est un refus sûr : rien n’est visible', async () => {
    const g = graph((_c, n) => (n === 2 ? new Response('{}', { status: 503 }) : null));
    await expect(run(g, [photo('a'), photo('b')])).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('Rien n’a été publié') });
    expect(g.calls.some((c) => c.url.endsWith('/feed'))).toBe(false);
  });

  it('une panne au post final (ou à une photo publiée d’emblée) reste une issue incertaine : jamais rejouée', async () => {
    const g1 = graph((c) => (c.url.endsWith('/feed') ? new Response('{}', { status: 502 }) : null));
    await expect(run(g1, [photo('a'), photo('b')])).rejects.toMatchObject({ name: 'OutcomeUnknownError' });
    const g2 = graph((c) => (c.url.endsWith('/photos') ? new Response('{}', { status: 502 }) : null));
    await expect(run(g2, [photo('a')])).rejects.toMatchObject({ name: 'OutcomeUnknownError' });
    const g3 = graph((c) => (c.url.endsWith('/videos') ? new Response('{}', { status: 504 }) : null));
    await expect(run(g3, [video('v')])).rejects.toMatchObject({ name: 'OutcomeUnknownError' });
  });

  it('un jeton refusé (code 190) demande de reconnecter la Page', async () => {
    const g = graph(() => new Response(JSON.stringify({ error: { code: 190, message: 'expiré' } }), { status: 400 }));
    await expect(run(g, [photo('a')])).rejects.toMatchObject({ name: 'ReconnectRequiredError' });
  });
});
