import { describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError, PublishRejectedError, QuotaExceededError, ReconnectRequiredError } from '../src/providers/errors.ts';
import type { ResolvedMedia } from '../src/providers/types.ts';
import { YOUTUBE_MAX_DESCRIPTION_BYTES, createYouTubeProvider, nextOffset, youtubeDescription, youtubePrivacy, youtubeTitle } from '../src/providers/youtube.ts';

const SESSION = 'https://upload.example/session-1';
const SOURCE = 'https://signed/clip.mp4';

const video = (o: Partial<ResolvedMedia> = {}): ResolvedMedia => ({
  id: 'm1', kind: 'video', name: 'ma-video_test.mp4', mimeType: 'video/mp4', alt: '', url: SOURCE, jpegUrl: null, thumbnailUrl: null, sizeBytes: 10, width: 1920, height: 1080, durationSeconds: 30, ...o,
});
const image = (): ResolvedMedia => ({ ...video({ id: 'i1', kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', url: 'https://signed/p.jpg' }) });

/** Faux stockage (lecture par plage) et faux YouTube (ouverture de session, envoi par morceaux, interrogation de la session). */
function world(o: {
  size?: number;
  noRange?: boolean;
  init?: () => Response | null;
  /** Appelé à chaque envoi de morceau (n = 1, 2…) : renvoyer une réponse pour la remplacer, ou 'drop' pour couper après avoir enregistré les octets. */
  chunk?: (n: number, c: { start: number; end: number; committed: number }) => Response | 'drop' | 'lose' | { keep: number } | null;
  status?: (n: number) => Response | 'fail' | null;
} = {}) {
  const size = o.size ?? 10;
  const source = Uint8Array.from({ length: size }, (_, i) => (i * 7 + 3) % 251);
  const received = new Uint8Array(size);
  let committed = 0;
  let created = false;
  let chunks = 0;
  let statuses = 0;
  const calls: { method: string; url: string; headers: Record<string, string>; body?: any }[] = [];
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });
  const resume = () => new Response(null, { status: 308, headers: committed > 0 ? { Range: `bytes=0-${committed - 1}` } : {} });
  const done = () => json({ id: 'VID1', kind: 'youtube#video' });

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });

    if (url === SOURCE) {
      const m = /bytes=(\d+)-(\d+)/.exec(headers.Range ?? '');
      if (!m || o.noRange) return new Response(source, { status: 200 });
      const [a, b] = [Number(m[1]), Math.min(Number(m[2]), size - 1)];
      return new Response(source.slice(a, b + 1), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${size}` } });
    }
    if (url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos')) {
      return o.init?.() ?? new Response(null, { status: 200, headers: { Location: SESSION } });
    }
    if (url === SESSION && method === 'PUT') {
      const range = headers['Content-Range'] ?? '';
      if (range.startsWith('bytes */')) {
        statuses++;
        const custom = o.status?.(statuses);
        if (custom === 'fail') throw new Error('réseau coupé');
        if (custom) return custom;
        return created ? done() : resume();
      }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
      const [start, end] = [Number(m[1]), Number(m[2])];
      chunks++;
      const custom = o.chunk?.(chunks, { start, end, committed });
      if (custom instanceof Response) return custom;
      const body = init!.body as Uint8Array;
      if (custom && typeof custom === 'object' && 'keep' in custom) {
        // YouTube n'enregistre que le début du morceau et demande la suite à partir de là.
        received.set(body.slice(0, custom.keep), start);
        committed = Math.max(committed, start + custom.keep);
        return resume();
      }
      received.set(body, start);
      committed = Math.max(committed, end + 1);
      if (committed >= size) created = true;
      if (custom === 'drop') throw new Error('connexion perdue après réception');
      if (custom === 'lose') return new Response('{', { status: 200 }); // créée, mais réponse illisible
      return created ? done() : resume();
    }
    throw new Error(`appel inattendu : ${method} ${url}`);
  });

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls, source, received,
    init: () => calls.find((c) => c.url.startsWith('https://www.googleapis.com/upload'))!,
    puts: () => calls.filter((c) => c.method === 'PUT' && !(c.headers['Content-Range'] ?? '').startsWith('bytes */')),
    reads: () => calls.filter((c) => c.url === SOURCE),
  };
}

const sleeps: number[] = [];
const provider = (w: ReturnType<typeof world>, env: Record<string, string> = {}, chunkBytes = 4) =>
  createYouTubeProvider(w.fetchImpl, env, { sleep: async (ms) => void sleeps.push(ms), chunkBytes, now: () => new Date('2026-10-24T20:00:00Z') });
const run = (p: ReturnType<typeof provider>, media: ResolvedMedia[] = [video()], content = 'Mon titre\nLa description') =>
  p.publish({ accessToken: 'TOKEN', integration: { id: 'i1', internalId: 'UC1', settings: {} }, posts: [{ id: 'p1', content, media, settings: {} }] });

describe('YouTube : envoi d’une vidéo', () => {
  it('ouvre une session privée avec le titre et la description, envoie le fichier, renvoie l’identifiant et le lien', async () => {
    const w = world();
    const r = await run(provider(w, {}, 1024));
    expect(r).toEqual([{ releaseId: 'VID1', releaseUrl: 'https://www.youtube.com/watch?v=VID1' }]);
    const init = w.init();
    expect(init.method).toBe('POST');
    expect(init.url).toContain('uploadType=resumable');
    expect(init.url).toContain('part=snippet,status');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer TOKEN', 'X-Upload-Content-Length': '10', 'X-Upload-Content-Type': 'video/mp4' });
    expect(init.body).toEqual({
      snippet: { title: 'Mon titre', description: 'Mon titre\nLa description', categoryId: '22' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    });
    expect(w.received).toEqual(w.source);
    expect(w.puts()).toHaveLength(1);
  });

  it('découpe en morceaux, relit chacun par plage dans le stockage et envoie tous les octets, dans l’ordre', async () => {
    const w = world({ size: 10 });
    await run(provider(w, {}, 4));
    expect(w.puts().map((c) => c.headers['Content-Range'])).toEqual(['bytes 0-3/10', 'bytes 4-7/10', 'bytes 8-9/10']);
    expect(w.reads().map((c) => c.headers.Range)).toEqual(['bytes=0-3', 'bytes=4-7', 'bytes=8-9']);
    expect(w.received).toEqual(w.source);
    expect(w.puts()[0]!.headers.Authorization).toBe('Bearer TOKEN');
  });

  it('reprend à l’octet indiqué par YouTube quand il n’a gardé qu’une partie du morceau', async () => {
    const w = world({ size: 10, chunk: (n) => (n === 1 ? { keep: 2 } : null) });
    await run(provider(w, {}, 4));
    expect(w.puts().map((c) => c.headers['Content-Range'])).toEqual(['bytes 0-3/10', 'bytes 2-5/10', 'bytes 6-9/10']);
    expect(w.received).toEqual(w.source);
  });

  it('un morceau refusé par une panne passagère est renvoyé après avoir interrogé la session', async () => {
    const w = world({ chunk: (n) => (n === 2 ? new Response('Service Unavailable', { status: 503 }) : null) });
    const r = await run(provider(w, {}, 4));
    expect(r[0]!.releaseId).toBe('VID1');
    expect(w.received).toEqual(w.source);
    expect(sleeps.at(-1)).toBe(1000); // un premier délai avant la nouvelle tentative
    expect(w.calls.filter((c) => (c.headers['Content-Range'] ?? '').startsWith('bytes */'))).toHaveLength(1);
  });

  it('si les octets sont arrivés mais la connexion a été coupée, la session le dit et rien n’est renvoyé en double', async () => {
    const w = world({ chunk: (n) => (n === 2 ? 'drop' : null) });
    await run(provider(w, {}, 4));
    expect(w.puts().map((c) => c.headers['Content-Range'])).toEqual(['bytes 0-3/10', 'bytes 4-7/10', 'bytes 8-9/10']); // le morceau 2 n'est pas renvoyé
    expect(w.received).toEqual(w.source);
  });

  it('dernier morceau reçu mais réponse perdue : la session confirme la vidéo, sans la créer deux fois', async () => {
    const w = world({ chunk: (n) => (n === 3 ? 'lose' : null) });
    const r = await run(provider(w, {}, 4));
    expect(r[0]!.releaseId).toBe('VID1');
    expect(w.puts()).toHaveLength(3);
  });

  it('une coupure avant le dernier morceau, qui persiste, est un refus sûr : rien n’a été créé', async () => {
    const w = world({ chunk: () => new Response('boom', { status: 503 }), status: () => 'fail' });
    const err = await run(provider(w, {}, 4)).catch((e) => e);
    expect(err).toBeInstanceOf(PublishRejectedError);
    expect(String(err.message)).toContain('Rien n’a été publié');
  });

  it('une coupure sur le dernier morceau, qui persiste, est une issue inconnue : jamais rejouée', async () => {
    const w = world({ size: 4, chunk: () => new Response('boom', { status: 502 }), status: () => 'fail' });
    const err = await run(provider(w, {}, 4), [video({ sizeBytes: 4 })]).catch((e) => e);
    expect(err).toBeInstanceOf(OutcomeUnknownError);
    expect(String(err.message)).toContain('YouTube Studio');
  });

  it('une session expirée est un refus sûr', async () => {
    const w = world({ chunk: (n) => (n === 2 ? new Response('gone', { status: 410 }) : null) });
    await expect(run(provider(w, {}, 4))).rejects.toThrow(/session d’envoi.*expiré/);
  });

  it('un refus clair du fichier par YouTube (400) est repris avec le texte de Google', async () => {
    const w = world({ chunk: () => new Response(JSON.stringify({ error: { message: 'Invalid video format' } }), { status: 400 }) });
    await expect(run(provider(w, {}, 4))).rejects.toThrow(/Invalid video format/);
  });

  it('un jeton expiré en cours d’envoi demande de reconnecter le canal', async () => {
    const w = world({ chunk: () => new Response('', { status: 401 }) });
    await expect(run(provider(w, {}, 4))).rejects.toBeInstanceOf(ReconnectRequiredError);
  });
});

describe('YouTube : refus à l’ouverture de la session', () => {
  const failInit = (status: number, body: unknown = {}) => world({ init: () => new Response(JSON.stringify(body), { status }) });

  it('quota épuisé : message clair, rien n’a été envoyé', async () => {
    const w = failInit(403, { error: { message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } });
    const err = await run(provider(w)).catch((e) => e);
    expect(err).toBeInstanceOf(PublishRejectedError);
    expect(err.message).toMatch(/quota quotidien/);
    expect(w.puts()).toHaveLength(0);
  });

  it('quota épuisé : l’erreur annonce le renouvellement (minuit à Los Angeles, plus dix minutes) pour que la publication soit reportée', async () => {
    const w = failInit(403, { error: { message: 'The request cannot be completed because you have exceeded your quota.' } });
    const err = await run(provider(w)).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    // 24 octobre 2026 à 20 h UTC = 13 h à Los Angeles (heure d'été) : minuit tombe le 25 à 7 h UTC.
    expect((err as QuotaExceededError).retryAt.toISOString()).toBe('2026-10-25T07:10:00.000Z');
  });

  it('une limite de requêtes trop rapides (sans quota) n’est pas reportée au lendemain', async () => {
    const err = await run(provider(failInit(403, { error: { message: 'Rate Limit Exceeded' } }))).catch((e) => e);
    expect(err).toBeInstanceOf(PublishRejectedError);
    expect(err).not.toBeInstanceOf(QuotaExceededError);
  });

  it('limite d’envois de la chaîne atteinte', async () => {
    await expect(run(provider(failInit(400, { error: { message: 'The user has exceeded the number of videos they may upload.', errors: [{ reason: 'uploadLimitExceeded' }] } })))).rejects.toThrow(/limite d’envois/);
  });

  it('compte Google sans chaîne', async () => {
    await expect(run(provider(failInit(403, { error: { message: 'Unauthorized: youtubeSignupRequired' } })))).rejects.toThrow(/pas de chaîne YouTube/);
  });

  it('jeton refusé (401) : il faut reconnecter le canal', async () => {
    await expect(run(provider(failInit(401)))).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('une panne de YouTube (5xx) à l’ouverture est un refus sûr, pas une issue inconnue', async () => {
    const err = await run(provider(failInit(503))).catch((e) => e);
    expect(err).toBeInstanceOf(PublishRejectedError);
  });

  it('une réponse sans adresse de session est refusée', async () => {
    const w = world({ init: () => new Response(null, { status: 200 }) });
    await expect(run(provider(w))).rejects.toThrow(/session d’envoi/);
  });
});

describe('YouTube : ce qui est vérifié avant tout appel réseau', () => {
  const noCalls = async (media: ResolvedMedia[], message: RegExp) => {
    const w = world();
    await expect(run(provider(w), media)).rejects.toThrow(message);
    expect(w.calls).toHaveLength(0);
  };

  it('exige une vidéo', () => noCalls([], /exige une vidéo/));
  it('refuse une image', () => noCalls([image()], /une seule vidéo/));
  it('refuse deux vidéos ou une vidéo accompagnée d’une image', async () => {
    await noCalls([video(), video({ id: 'm2' })], /une seule vidéo/);
    await noCalls([video(), image()], /une seule vidéo/);
  });

  it('lit la taille dans le stockage quand la bibliothèque ne la connaît pas', async () => {
    const w = world({ size: 10 });
    // Le faux stockage répond « bytes 0-0/10 » à une lecture d'un octet.
    await run(provider(w, {}, 1024), [video({ sizeBytes: null })]);
    expect(w.init().headers['X-Upload-Content-Length']).toBe('10');
  });

  it('refuse une vidéo dont la taille est introuvable', async () => {
    const w = world({ noRange: true });
    await expect(run(provider(w), [video({ sizeBytes: null })])).rejects.toThrow(/taille.*inconnue/);
  });

  it('refuse un stockage qui ne sait pas lire par morceaux (rien n’est créé chez YouTube)', async () => {
    const w = world({ noRange: true });
    await expect(run(provider(w, {}, 4))).rejects.toThrow(/pas lisible par morceaux/);
    expect(w.puts()).toHaveLength(0);
  });

  it('un type de fichier inconnu part en application/octet-stream', async () => {
    const w = world();
    await run(provider(w, {}, 1024), [video({ mimeType: null })]);
    expect(w.init().headers['X-Upload-Content-Type']).toBe('application/octet-stream');
  });
});

describe('YouTube : visibilité, titre et description', () => {
  it('la visibilité est privée par défaut et pour toute valeur inconnue', () => {
    expect(youtubePrivacy({})).toBe('private');
    expect(youtubePrivacy({ YOUTUBE_PRIVACY: '' })).toBe('private');
    expect(youtubePrivacy({ YOUTUBE_PRIVACY: 'n’importe quoi' })).toBe('private');
  });

  it('elle n’est publique ou non répertoriée que si on le demande', async () => {
    expect(youtubePrivacy({ YOUTUBE_PRIVACY: ' Public ' })).toBe('public');
    expect(youtubePrivacy({ YOUTUBE_PRIVACY: 'unlisted' })).toBe('unlisted');
    const w = world();
    await run(provider(w, { YOUTUBE_PRIVACY: 'unlisted' }, 1024));
    expect(w.init().body.status.privacyStatus).toBe('unlisted');
  });

  it('le titre est la première ligne non vide, sans < ni >, coupée à 100 caractères', () => {
    expect(youtubeTitle('\n\n  Mon <b>titre</b>  \nsuite', 'x.mp4')).toBe('Mon btitre/b');
    expect(youtubeTitle('é'.repeat(150), 'x.mp4')).toBe('é'.repeat(100));
    expect([...youtubeTitle('😀'.repeat(150), 'x.mp4')]).toHaveLength(100);
  });

  it('sans texte, le titre vient du nom du fichier, sans extension', () => {
    expect(youtubeTitle('', 'ma-video_test.mp4')).toBe('ma video test');
    expect(youtubeTitle('   ', '.mp4')).toBe('Vidéo');
    expect(youtubeTitle('<>', 'clip.MOV')).toBe('clip');
  });

  it('la description garde le texte entier, sans < ni >', () => {
    expect(youtubeDescription('  Ligne 1\nLigne <2>  ')).toBe('Ligne 1\nLigne 2');
  });

  it('la description est coupée à 5 000 octets (pas caractères), sans casser un caractère', () => {
    const text = 'é'.repeat(4000); // 8 000 octets
    const cut = youtubeDescription(text);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(YOUTUBE_MAX_DESCRIPTION_BYTES);
    expect([...cut].length).toBe(2500);
    expect(cut).not.toContain('�');
    expect(youtubeDescription('a'.repeat(YOUTUBE_MAX_DESCRIPTION_BYTES))).toHaveLength(YOUTUBE_MAX_DESCRIPTION_BYTES);
  });

  it('nextOffset lit l’en-tête Range d’une réponse « reprise »', () => {
    expect(nextOffset('bytes=0-8388607')).toBe(8388608);
    expect(nextOffset(null)).toBe(0);
    expect(nextOffset('n’importe quoi')).toBe(0);
  });
});
