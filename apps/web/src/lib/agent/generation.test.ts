import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationRepository, GeneratedMediaInput, MediaItem, VideoJobRecord } from '@/lib/data/types';
import type { ImageProvider, VideoCheck, VideoProvider } from './generate';
import { advanceVideoJob, createGenerationTools, isPublicHttpsUrl, mediaSlug, VIDEO_TIMEOUT_MS, type GenerationDeps } from './generation';

const T0 = Date.parse('2026-10-27T10:00:00Z');

/** Un dépôt en mémoire qui respecte le contrat de `GenerationRepository` (plafond, prise en charge unique d'une tâche, médiathèque). */
function memory(over: { used?: { image?: number; video?: number }; saveFails?: boolean; jobFails?: boolean } = {}) {
  const media: MediaItem[] = [];
  const jobs = new Map<string, VideoJobRecord>();
  const used = { image: over.used?.image ?? 0, video: over.used?.video ?? 0 };
  let seq = 0;
  const repo: GenerationRepository = {
    async reserve(kind, limit) {
      if (used[kind] >= limit) return false;
      used[kind]++;
      return true;
    },
    async createMedia(input: GeneratedMediaInput) {
      if (over.saveFails) return null;
      const kind = input.mimeType.startsWith('video/') ? 'video' : 'image';
      const item: MediaItem = {
        id: `m${++seq}`, path: `org/${input.name}`, name: input.name, mimeType: input.mimeType, kind, sizeBytes: input.bytes.byteLength, width: input.width, height: input.height,
        durationSeconds: input.durationSeconds, alt: input.alt, createdAt: new Date(T0).toISOString(), url: `https://cdn.test/m${seq}`, thumbUrl: null,
      };
      media.push(item);
      return item;
    },
    async activeJobs() {
      return [...jobs.values()].filter((j) => j.status === 'pending').length;
    },
    async createJob(input) {
      if (over.jobFails) return null;
      const job: VideoJobRecord = { id: `j${++seq}`, status: 'pending', orientation: input.orientation, prompt: input.prompt, mediaId: null, error: null, createdAt: new Date(T0).toISOString(), providerTaskId: input.providerTaskId, claimedAt: null };
      jobs.set(job.id, job);
      return { ...job };
    },
    async jobs(ids) {
      return ids.flatMap((id) => (jobs.has(id) ? [{ ...jobs.get(id)! }] : []));
    },
    async claimJob(id, staleBefore) {
      const j = jobs.get(id);
      if (!j || j.status !== 'pending' || (j.claimedAt && j.claimedAt >= staleBefore)) return false;
      j.claimedAt = new Date(T0 + 1).toISOString();
      return true;
    },
    async settleJob(id, result) {
      const j = jobs.get(id);
      if (!j) return false;
      j.claimedAt = null;
      j.status = result.status;
      if (result.status === 'completed') Object.assign(j, { mediaId: result.mediaId, error: null });
      if (result.status === 'failed') j.error = result.error;
      return true;
    },
  };
  return { repo, media, jobs, used };
}

const jpeg = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' as const, width: 1024, height: 1024 };
const library: MediaItem[] = [
  { id: 'lib1', path: 'a', name: 'a.jpg', mimeType: 'image/jpeg', kind: 'image', sizeBytes: 1, width: 1, height: 1, durationSeconds: null, alt: '', createdAt: '', url: 'https://cdn.test/lib1?sig=1', thumbUrl: null },
  { id: 'lib2', path: 'b', name: 'b.jpg', mimeType: 'image/jpeg', kind: 'image', sizeBytes: 1, width: 1, height: 1, durationSeconds: null, alt: '', createdAt: '', url: 'https://cdn.test/lib2?sig=1', thumbUrl: null },
  { id: 'vid1', path: 'c', name: 'c.mp4', mimeType: 'video/mp4', kind: 'video', sizeBytes: 1, width: 1, height: 1, durationSeconds: 5, alt: '', createdAt: '', url: 'https://cdn.test/vid1', thumbUrl: null },
  { id: 'nourl', path: 'd', name: 'd.jpg', mimeType: 'image/jpeg', kind: 'image', sizeBytes: 1, width: 1, height: 1, durationSeconds: null, alt: '', createdAt: '', url: null, thumbUrl: null },
];

function setup(over: Partial<GenerationDeps> & { repo?: ReturnType<typeof memory>; image?: ImageProvider | null; checks?: VideoCheck[]; video?: VideoProvider | null } = {}) {
  const repo = over.repo ?? memory();
  const imageCalls: [string, string][] = [];
  const videoStarts: unknown[] = [];
  const checks = [...(over.checks ?? [])];
  const images: ImageProvider | null = over.image === undefined ? { generate: async (prompt, size) => (imageCalls.push([prompt, size]), jpeg) } : over.image;
  const videos: VideoProvider | null = over.video === undefined ? {
    start: async (input) => (videoStarts.push(input), 'task-1'),
    check: async () => checks.shift() ?? { state: 'pending' },
  } : over.video;
  const deps: GenerationDeps = {
    repos: { generation: repo.repo, media: { byIds: async (ids) => ids.flatMap((id) => library.concat(repo.media).filter((m) => m.id === id)) } },
    images, videos, limits: { imagesPerDay: 3, videosPerDay: 2 }, now: () => T0 + 60_000, ...over,
  };
  return { deps, tools: createGenerationTools(deps), repo, imageCalls, videoStarts };
}

describe('mediaSlug et adresses', () => {
  it('un nom lisible tiré de la description, sans accents ni signes', () => {
    expect(mediaSlug('Un atelier de menuiserie, au lever du jour !', 'image')).toBe('ai-image-un-atelier-de-menuiserie-au-lever-du');
    expect(mediaSlug('Été à la montagne', 'video')).toBe('ai-video-ete-a-la-montagne');
    expect(mediaSlug('日本語 ###', 'image')).toBe('ai-image-image');
  });

  it('une adresse de téléchargement est publique et en HTTPS', () => {
    for (const ok of ['https://cdn.evolink.ai/v/1.mp4', 'https://a.b.example/x?y=1']) expect(isPublicHttpsUrl(ok), ok).toBe(true);
    for (const bad of ['http://cdn.example.com/v.mp4', 'https://localhost/v.mp4', 'https://127.0.0.1/v.mp4', 'https://[::1]/v.mp4', 'https://192.168.1.4/v.mp4', 'https://nas.local/v.mp4', 'https://svc.internal/v.mp4', 'https://user:pw@cdn.example.com/v.mp4', 'https://monserveur/v.mp4', 'file:///etc/passwd', 'pas une adresse', 'https://2130706433/v.mp4']) {
      expect(isPublicHttpsUrl(bad), bad).toBe(false);
    }
  });
});

describe('generateImage', () => {
  it('génère, range l’image dans la médiathèque avec son nom, ses dimensions et son texte alternatif', async () => {
    const { tools, repo, imageCalls } = setup();
    const result = await tools.generateImage({ prompt: '  Un atelier de menuiserie au lever du jour  ', size: 'square', alt: 'Un\n atelier   éclairé' });
    expect(result.ok).toBe(true);
    expect(imageCalls).toEqual([['Un atelier de menuiserie au lever du jour', 'square']]);
    expect(repo.media).toHaveLength(1);
    expect(repo.media[0]).toMatchObject({ name: 'ai-image-un-atelier-de-menuiserie-au-lever-du.jpg', mimeType: 'image/jpeg', kind: 'image', width: 1024, height: 1024, alt: 'Un atelier éclairé' });
    expect(repo.used.image).toBe(1);
  });

  it('coupe une description démesurée', async () => {
    const { tools, imageCalls } = setup();
    await tools.generateImage({ prompt: 'a'.repeat(5_000), size: 'square' });
    expect(imageCalls[0]![0]).toHaveLength(2_000);
  });

  it('refuse sans appeler le fournisseur : fournisseur absent, description vide, plafond atteint, temps insuffisant', async () => {
    const none = setup({ image: null });
    expect(await none.tools.generateImage({ prompt: 'x', size: 'square' })).toMatchObject({ ok: false, error: expect.stringMatching(/not available/) });

    const empty = setup();
    expect(await empty.tools.generateImage({ prompt: '   ', size: 'square' })).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });

    const full = setup({ repo: memory({ used: { image: 3 } }) });
    expect(await full.tools.generateImage({ prompt: 'x', size: 'square' })).toMatchObject({ ok: false, error: expect.stringMatching(/limit of 3 generated pictures per day/) });

    const late = setup({ deadline: T0 + 60_000 + 10_000 });
    expect(await late.tools.generateImage({ prompt: 'x', size: 'square' })).toMatchObject({ ok: false, error: expect.stringMatching(/Not enough time/) });
    expect(late.repo.used.image).toBe(0);
    expect([empty, none, full, late].flatMap((s) => s.imageCalls)).toEqual([]);
  });

  it('assez de temps : la génération part', async () => {
    const { tools, imageCalls } = setup({ deadline: T0 + 60_000 + 40_000 });
    expect((await tools.generateImage({ prompt: 'x', size: 'landscape' })).ok).toBe(true);
    expect(imageCalls).toEqual([['x', 'landscape']]);
  });

  it('un échec du fournisseur ne laisse rien dans la médiathèque et dit pourquoi, sans réponse brute', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = new Headers();
    const failing = (error: Error) => setup({ image: { generate: async () => { throw error; } } });
    const moderated = failing(new OpenAI.BadRequestError(400, { code: 'moderation_blocked' }, 'secret details', h));
    const r1 = await moderated.tools.generateImage({ prompt: 'x', size: 'square' });
    expect(r1).toMatchObject({ ok: false, error: expect.stringMatching(/content policy/) });
    expect(JSON.stringify(r1)).not.toContain('secret details');
    expect(moderated.repo.media).toHaveLength(0);
    const generic = failing(new Error('réseau'));
    expect(await generic.tools.generateImage({ prompt: 'x', size: 'square' })).toMatchObject({ ok: false, error: expect.stringMatching(/failed/) });
    log.mockRestore();
  });

  it('une image générée mais non enregistrée est signalée', async () => {
    const { tools } = setup({ repo: memory({ saveFails: true }) });
    expect(await tools.generateImage({ prompt: 'x', size: 'square' })).toMatchObject({ ok: false, error: expect.stringMatching(/could not be saved/) });
  });
});

describe('startVideo', () => {
  it('lance la vidéo chez le fournisseur avec les adresses signées des images de référence, et garde sa tâche', async () => {
    const { tools, repo, videoStarts } = setup();
    const result = await tools.startVideo({ prompt: 'Un rabot sur du chêne', orientation: 'vertical', referenceIds: ['lib1', 'lib2', 'lib1'] });
    expect(result).toMatchObject({ ok: true, job: { status: 'pending', orientation: 'vertical', prompt: 'Un rabot sur du chêne', mediaId: null, error: null } });
    expect(videoStarts).toEqual([{ prompt: 'Un rabot sur du chêne', orientation: 'vertical', imageUrls: ['https://cdn.test/lib1?sig=1', 'https://cdn.test/lib2?sig=1'] }]);
    expect(repo.used.video).toBe(1);
    // L'identifiant chez le fournisseur ne sort pas du serveur.
    expect(JSON.stringify(result)).not.toContain('task-1');
    expect([...repo.jobs.values()][0]).toMatchObject({ providerTaskId: 'task-1' });
  });

  it('au plus trois images de référence, qui doivent être des images de la médiathèque', async () => {
    const many = setup();
    const four = await many.tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: ['lib1', 'lib2', 'lib1', 'nourl'] });
    expect(four).toMatchObject({ ok: false });
    for (const refs of [['inconnue'], ['vid1'], ['nourl']]) {
      const s = setup();
      expect(await s.tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: refs }), refs.join()).toMatchObject({ ok: false, error: expect.stringMatching(/Reference pictures/) });
      expect(s.videoStarts).toEqual([]);
      expect(s.repo.used.video).toBe(0);
    }
  });

  it('refuse sans rien lancer : fournisseur absent, description vide, trop de vidéos en cours, plafond atteint', async () => {
    expect(await setup({ video: null }).tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/not available/) });
    expect(await setup().tools.startVideo({ prompt: ' ', orientation: 'vertical', referenceIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });

    const busy = setup();
    for (let i = 0; i < 3; i++) await busy.repo.repo.createJob({ prompt: 'p', orientation: 'vertical', providerTaskId: `t${i}`, referenceMediaIds: [] });
    expect(await busy.tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/already being generated/) });

    const full = setup({ repo: memory({ used: { video: 2 } }) });
    expect(await full.tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/limit of 2 generated videos per day/) });
    expect([busy, full].flatMap((s) => s.videoStarts)).toEqual([]);
  });

  it('un refus du fournisseur est rapporté, sans tâche gardée', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tools, repo } = setup({ video: { start: async () => { throw new Error('insufficient_balance: Top up'); }, check: async () => ({ state: 'pending' }) } });
    expect(await tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: [] })).toMatchObject({ ok: false, error: expect.stringContaining('insufficient_balance: Top up') });
    expect(repo.jobs.size).toBe(0);
    log.mockRestore();
  });

  it('une vidéo lancée dont la tâche ne s’enregistre pas est signalée', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tools } = setup({ repo: memory({ jobFails: true }) });
    expect(await tools.startVideo({ prompt: 'x', orientation: 'vertical', referenceIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/could not be tracked/) });
    log.mockRestore();
  });
});

describe('advanceVideoJob : faire avancer une vidéo', () => {
  const started = async (s: ReturnType<typeof setup>, orientation: 'vertical' | 'horizontal' = 'vertical') => {
    const r = await s.tools.startVideo({ prompt: 'Un rabot sur du chêne', orientation, referenceIds: [] });
    if (!r.ok) throw new Error(r.error);
    return r.job.id;
  };
  const video = (over: { type?: string; size?: number; status?: number; url?: string } = {}) => vi.fn(async () => {
    const r = new Response(new Uint8Array(over.size ?? 1_000), { status: over.status ?? 200, headers: { 'content-type': over.type ?? 'video/mp4' } });
    if (over.url) Object.defineProperty(r, 'url', { value: over.url });
    return r;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const ready: VideoCheck = { state: 'completed', url: 'https://cdn.evolink.test/v.mp4' };

  it('tant que le fournisseur travaille, rien ne change', async () => {
    const fetcher = video();
    const s = setup({ checks: [{ state: 'pending' }], fetcher });
    const id = await started(s);
    const r = await advanceVideoJob(s.deps, id);
    expect(r).toMatchObject({ ok: true, job: { id, status: 'pending' }, item: null });
    expect(fetcher).not.toHaveBeenCalled();
    expect(s.repo.media).toHaveLength(0);
  });

  it('vidéo prête : téléchargée, rangée dans la médiathèque (format demandé), tâche terminée', async () => {
    const fetcher = video({ size: 5_000 });
    const s = setup({ checks: [ready], fetcher });
    const id = await started(s);
    const r = await advanceVideoJob(s.deps, id);
    expect(r).toMatchObject({ ok: true, job: { id, status: 'completed', mediaId: 'm' + (s.repo.media.length ? s.repo.media[0]!.id.slice(1) : '?'), error: null } });
    expect(s.repo.media).toHaveLength(1);
    expect(s.repo.media[0]).toMatchObject({ name: 'ai-video-un-rabot-sur-du-chene.mp4', mimeType: 'video/mp4', kind: 'video', width: 720, height: 1280, durationSeconds: 8, sizeBytes: 5_000 });
    expect(r.ok && r.item?.id).toBe(s.repo.media[0]!.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(s.repo.jobs.get(id)).toMatchObject({ status: 'completed', mediaId: s.repo.media[0]!.id, claimedAt: null });

    // Interrogée de nouveau : elle rend la vidéo déjà enregistrée, sans rien refaire.
    const again = await advanceVideoJob(s.deps, id);
    expect(again).toMatchObject({ ok: true, job: { status: 'completed' }, item: { id: s.repo.media[0]!.id } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(s.repo.media).toHaveLength(1);
  });

  it('horizontale : 1280 × 720', async () => {
    const s = setup({ checks: [ready], fetcher: video() });
    const id = await started(s, 'horizontal');
    await advanceVideoJob(s.deps, id);
    expect(s.repo.media[0]).toMatchObject({ width: 1280, height: 720 });
  });

  it('deux interrogations simultanées n’enregistrent qu’une vidéo', async () => {
    const s = setup({ checks: [ready, ready], fetcher: video() });
    const id = await started(s);
    const [a, b] = await Promise.all([advanceVideoJob(s.deps, id), advanceVideoJob(s.deps, id)]);
    expect(s.repo.media).toHaveLength(1);
    expect([a, b].filter((r) => r.ok && r.job.status === 'completed')).toHaveLength(1);
    expect(s.repo.jobs.get(id)!.status).toBe('completed');
  });

  it('une vidéo en cours d’enregistrement par une autre requête est rendue telle quelle, sans interroger le fournisseur', async () => {
    const check = vi.fn(async (): Promise<VideoCheck> => ready);
    const s = setup({ video: { start: async () => 'task-1', check }, fetcher: video() });
    const id = await started(s);
    s.repo.jobs.get(id)!.claimedAt = new Date(T0 + 30_000).toISOString(); // il y a 30 s
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'pending' } });
    expect(check).not.toHaveBeenCalled();
  });

  it('une prise en charge restée sans suite (requête coupée) est reprise', async () => {
    const s = setup({ checks: [ready], fetcher: video(), now: () => T0 + 10 * 60_000 });
    const id = await started(s);
    s.repo.jobs.get(id)!.claimedAt = new Date(T0 + 60_000).toISOString(); // il y a 9 minutes
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'completed' } });
    expect(s.repo.media).toHaveLength(1);
  });

  it('un échec chez le fournisseur termine la tâche, avec une raison courte', async () => {
    const s = setup({ checks: [{ state: 'failed', error: `content_policy: ${'x'.repeat(500)}` }] });
    const id = await started(s);
    const r = await advanceVideoJob(s.deps, id);
    expect(r).toMatchObject({ ok: true, job: { status: 'failed' } });
    expect(r.ok && r.job.error).toHaveLength(300);
    expect(s.repo.jobs.get(id)).toMatchObject({ status: 'failed' });
  });

  it('au bout de 30 minutes la vidéo est abandonnée, sans interroger le fournisseur', async () => {
    const check = vi.fn(async (): Promise<VideoCheck> => ({ state: 'pending' }));
    const s = setup({ video: { start: async () => 'task-1', check }, now: () => T0 + VIDEO_TIMEOUT_MS + 1_000 });
    const id = await started(s);
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'failed', error: expect.stringMatching(/30 minutes/) } });
    expect(check).not.toHaveBeenCalled();
  });

  it('un fournisseur injoignable laisse la tâche en attente', async () => {
    const s = setup({ video: { start: async () => 'task-1', check: async () => { throw new Error('réseau'); } } });
    const id = await started(s);
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'pending' } });
    expect(s.repo.jobs.get(id)!.status).toBe('pending');
  });

  it('un téléchargement qui échoue passagèrement relâche la tâche : la prochaine interrogation réessaie', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup({ checks: [ready, ready], fetcher: video({ status: 503 }) });
    const id = await started(s);
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'pending' } });
    expect(s.repo.jobs.get(id)).toMatchObject({ status: 'pending', claimedAt: null });
    s.deps.fetcher = video();
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'completed' } });
    expect(s.repo.media).toHaveLength(1);
    log.mockRestore();
  });

  it('un stockage qui échoue relâche aussi la tâche', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = memory();
    const s = setup({ repo, checks: [ready], fetcher: video() });
    const id = await started(s);
    const original = repo.repo.createMedia;
    repo.repo.createMedia = async () => null;
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'pending' } });
    expect(repo.jobs.get(id)!.claimedAt).toBeNull();
    repo.repo.createMedia = original;
    log.mockRestore();
  });

  it.each([
    ['une adresse en HTTP', { check: { state: 'completed', url: 'http://cdn.test/v.mp4' } as VideoCheck, fetcher: video() }],
    ['une adresse locale', { check: { state: 'completed', url: 'https://127.0.0.1/v.mp4' } as VideoCheck, fetcher: video() }],
    ['un fichier qui n’est pas une vidéo', { check: ready, fetcher: video({ type: 'text/html' }) }],
    ['une redirection vers une adresse locale', { check: ready, fetcher: video({ url: 'https://169.254.169.254/latest' }) }],
    ['un fichier trop gros', { check: ready, fetcher: (async () => new Response(new Uint8Array(10), { headers: { 'content-type': 'video/mp4', 'content-length': String(300 * 1024 * 1024) } })) as typeof fetch }],
  ])('%s termine la tâche en échec, sans rien enregistrer', async (_name, o) => {
    const s = setup({ checks: [o.check], fetcher: o.fetcher });
    const id = await started(s);
    expect(await advanceVideoJob(s.deps, id)).toMatchObject({ ok: true, job: { status: 'failed' } });
    expect(s.repo.media).toHaveLength(0);
    expect(s.repo.jobs.get(id)).toMatchObject({ status: 'failed', claimedAt: null });
  });

  it('une tâche inconnue (ou d’un autre) est introuvable', async () => {
    const s = setup();
    expect(await advanceVideoJob(s.deps, 'fantome')).toEqual({ ok: false, error: 'Video job not found.' });
  });

  it('sans fournisseur sur ce serveur, la tâche est rendue telle quelle', async () => {
    const s = setup();
    const id = await started(s);
    const r = await advanceVideoJob({ ...s.deps, videos: null }, id);
    expect(r).toMatchObject({ ok: true, job: { status: 'pending' } });
  });

  it('via l’outil videoStatus de l’agent', async () => {
    const s = setup({ checks: [ready], fetcher: video() });
    const id = await started(s);
    expect(await s.tools.videoStatus(id)).toMatchObject({ ok: true, job: { status: 'completed' }, item: { kind: 'video' } });
  });
});
