import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_IMAGE_MODEL, imageModel, imageQuality, imagesPerDay, videoConfigured, videosPerDay } from './config';
import { evolinkVideoProvider, explainImageError, IMAGE_SIZES, sdkImageProvider, VIDEO_FORMAT } from './generate';

afterEach(() => {
  for (const name of ['OPENAI_IMAGE_MODEL', 'OPENAI_IMAGE_QUALITY', 'EVOLINK_API_KEY', 'AGENT_IMAGES_PER_DAY', 'AGENT_VIDEOS_PER_DAY']) delete process.env[name];
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('configuration de la génération', () => {
  it('images : le modèle de Postiz par défaut, qualité « medium », modifiables par l’environnement', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('chatgpt-image-latest');
    expect(imageModel()).toBe('chatgpt-image-latest');
    expect(imageQuality()).toBe('medium');
    process.env.OPENAI_IMAGE_MODEL = ' gpt-image-1 ';
    process.env.OPENAI_IMAGE_QUALITY = 'HIGH';
    expect(imageModel()).toBe('gpt-image-1');
    expect(imageQuality()).toBe('high');
    process.env.OPENAI_IMAGE_QUALITY = 'n’importe quoi';
    expect(imageQuality()).toBe('medium');
  });

  it('vidéos : proposées seulement avec une clé Evolink', () => {
    expect(videoConfigured()).toBe(false);
    process.env.EVOLINK_API_KEY = '  ';
    expect(videoConfigured()).toBe(false);
    process.env.EVOLINK_API_KEY = 'cle-de-test';
    expect(videoConfigured()).toBe(true);
  });

  it('plafonds journaliers : valeurs par défaut, réglables, 0 désactive, jamais négatifs ni illisibles', () => {
    expect([imagesPerDay(), videosPerDay()]).toEqual([30, 5]);
    process.env.AGENT_IMAGES_PER_DAY = '12';
    process.env.AGENT_VIDEOS_PER_DAY = '0';
    expect([imagesPerDay(), videosPerDay()]).toEqual([12, 0]);
    process.env.AGENT_IMAGES_PER_DAY = '-4';
    process.env.AGENT_VIDEOS_PER_DAY = 'beaucoup';
    expect([imagesPerDay(), videosPerDay()]).toEqual([30, 5]);
    process.env.AGENT_IMAGES_PER_DAY = '999999';
    expect(imagesPerDay()).toBe(1_000);
  });
});

describe('images : l’API d’images d’OpenAI', () => {
  const b64 = Buffer.from('jpeg-bytes').toString('base64');

  it('demande une image JPEG au modèle de Postiz, dans la taille choisie, et rend ses octets', async () => {
    const seen: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
      return json({ created: 1, data: [{ b64_json: b64 }] });
    });
    const provider = sdkImageProvider(() => new OpenAI({ apiKey: 'cle-de-test', fetch: fetcher as unknown as typeof fetch, maxRetries: 0 }));
    const image = await provider.generate('Un atelier de menuiserie au lever du jour', 'portrait');

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toContain('/images/generations');
    expect(seen[0]!.auth).toBe('Bearer cle-de-test');
    expect(seen[0]!.body).toEqual({ model: 'chatgpt-image-latest', prompt: 'Un atelier de menuiserie au lever du jour', size: '1024x1536', quality: 'medium', output_format: 'jpeg', n: 1 });
    expect(Buffer.from(image.bytes).toString()).toBe('jpeg-bytes');
    expect(image).toMatchObject({ mimeType: 'image/jpeg', width: 1024, height: 1536 });
  });

  it('les trois tailles : carré, paysage, portrait', () => {
    expect(IMAGE_SIZES.square).toEqual({ api: '1024x1024', width: 1024, height: 1024 });
    expect(IMAGE_SIZES.landscape).toEqual({ api: '1536x1024', width: 1536, height: 1024 });
    expect(IMAGE_SIZES.portrait).toEqual({ api: '1024x1536', width: 1024, height: 1536 });
  });

  it('une réponse sans image est une erreur', async () => {
    const fetcher = (async () => json({ created: 1, data: [{}] })) as unknown as typeof fetch;
    const provider = sdkImageProvider(() => new OpenAI({ apiKey: 'k', fetch: fetcher, maxRetries: 0 }));
    await expect(provider.generate('x', 'square')).rejects.toThrow(/no image/);
  });

  it('ne crée pas le client sans appel (le SDK refuse de se construire sans clé)', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => sdkImageProvider()).not.toThrow();
  });

  it('explique les échecs au modèle sans lui transmettre la réponse brute du fournisseur', () => {
    const h = new Headers();
    expect(explainImageError(new OpenAI.BadRequestError(400, { code: 'moderation_blocked' }, 'Your request was rejected by the safety system', h))).toMatch(/content policy/);
    expect(explainImageError(new OpenAI.RateLimitError(429, { code: 'insufficient_quota' }, 'quota', h))).toMatch(/no credit left/);
    expect(explainImageError(new OpenAI.AuthenticationError(401, { code: 'invalid_api_key' }, 'sk-secret-123 is wrong', h))).not.toMatch(/sk-secret/);
    expect(explainImageError(new OpenAI.AuthenticationError(401, { code: 'invalid_api_key' }, 'bad', h))).toMatch(/rejected the server key/);
    expect(explainImageError(new OpenAI.RateLimitError(429, { code: 'rate_limit_exceeded' }, 'slow', h))).toMatch(/busy/);
    expect(explainImageError(new OpenAI.APIConnectionTimeoutError())).toMatch(/too long/);
    expect(explainImageError(new Error('boum'))).toMatch(/failed/);
  });
});

describe('vidéos : Seedance 2.0 par Evolink', () => {
  beforeEach(() => {
    process.env.EVOLINK_API_KEY = 'cle-evolink';
  });

  const recorder = (answer: () => Response) => {
    const calls: { url: string; method: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get('authorization') });
      return answer();
    }) as typeof fetch;
    return { calls, fetcher };
  };

  it('lance une vidéo verticale sans image : le modèle « texte vers vidéo », avec les réglages de Postiz', async () => {
    const { calls, fetcher } = recorder(() => json({ id: 'task-1' }));
    const id = await evolinkVideoProvider(fetcher).start({ prompt: 'Un rabot qui court sur du chêne', orientation: 'vertical', imageUrls: [] });
    expect(id).toBe('task-1');
    expect(calls[0]).toEqual({
      url: 'https://api.evolink.ai/v1/videos/generations', method: 'POST', auth: 'Bearer cle-evolink',
      body: { model: 'seedance-2.0-fast-text-to-video', prompt: 'Un rabot qui court sur du chêne', aspect_ratio: '9:16', duration: 8, quality: '720p', generate_audio: true },
    });
  });

  it('avec des images, le modèle « référence vers vidéo » ; en horizontal, 16:9', async () => {
    const { calls, fetcher } = recorder(() => json({ id: 'task-2' }));
    await evolinkVideoProvider(fetcher).start({ prompt: 'Même ambiance', orientation: 'horizontal', imageUrls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'] });
    expect(calls[0]!.body).toMatchObject({ model: 'seedance-2.0-fast-reference-to-video', image_urls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'], aspect_ratio: '16:9' });
  });

  it('un refus du fournisseur devient une erreur lisible, pas une réponse brute', async () => {
    const { fetcher } = recorder(() => json({ error: { code: 'insufficient_balance', message: 'Top up your account' } }, 402));
    await expect(evolinkVideoProvider(fetcher).start({ prompt: 'x', orientation: 'vertical', imageUrls: [] })).rejects.toThrow('insufficient_balance: Top up your account');
    const odd = recorder(() => new Response('<html>502</html>', { status: 502 }));
    await expect(evolinkVideoProvider(odd.fetcher).start({ prompt: 'x', orientation: 'vertical', imageUrls: [] })).rejects.toThrow('video provider answered 502');
  });

  it('interroge la tâche : en attente, terminée (adresse de la vidéo), échouée', async () => {
    const answers: Record<string, unknown> = {
      a: { status: 'pending' }, b: { status: 'processing' }, c: { status: 'completed', results: ['https://cdn.evolink.test/v.mp4'] },
      d: { status: 'completed', results: [] }, e: { status: 'failed', error: { code: 'content_policy', message: 'Rejected' } }, f: { status: 'cancelled' },
    };
    const { calls, fetcher } = recorder(() => json(answers[calls[calls.length - 1]!.url.split('/').pop()!]));
    const provider = evolinkVideoProvider(fetcher);
    expect(await provider.check('a')).toEqual({ state: 'pending' });
    expect(await provider.check('b')).toEqual({ state: 'pending' });
    expect(await provider.check('c')).toEqual({ state: 'completed', url: 'https://cdn.evolink.test/v.mp4' });
    expect(await provider.check('d')).toEqual({ state: 'failed', error: 'The provider finished without returning a video.' });
    expect(await provider.check('e')).toEqual({ state: 'failed', error: 'content_policy: Rejected' });
    expect(await provider.check('f')).toEqual({ state: 'failed', error: 'Video generation failed (status cancelled).' });
    expect(calls[0]).toMatchObject({ url: 'https://api.evolink.ai/v1/tasks/a', method: 'GET', auth: 'Bearer cle-evolink' });
  });

  it('un identifiant de tâche ne sort pas de l’adresse de l’API', async () => {
    const { calls, fetcher } = recorder(() => json({ status: 'pending' }));
    await evolinkVideoProvider(fetcher).check('../../admin?x=1');
    expect(calls[0]!.url).toBe('https://api.evolink.ai/v1/tasks/..%2F..%2Fadmin%3Fx%3D1');
  });

  it('le format enregistré est celui qu’on demande : 8 s, 720p', () => {
    expect(VIDEO_FORMAT).toEqual({ durationSeconds: 8, vertical: { width: 720, height: 1280 }, horizontal: { width: 1280, height: 720 } });
  });
});
