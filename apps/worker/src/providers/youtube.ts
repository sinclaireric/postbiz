import type { Env } from '@postbiz/core';
import { QUOTA_MARGIN_MS, nextPacificMidnight } from '../engine/quota.ts';
import { OutcomeUnknownError, PublishRejectedError, QuotaExceededError, ReconnectRequiredError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import { youtubeMetrics } from './insights/youtube.ts';
import { oauthRefresher } from './oauth.ts';
import type { ResolvedMedia, SocialProvider } from './types.ts';

// Publication d'une vidéo sur YouTube : envoi « résumable » de l'API YouTube Data v3 (videos.insert).
//   1. On ouvre une session d'envoi : titre, description et visibilité (POST, la réponse donne l'adresse de la session dans `Location`).
//   2. On envoie le fichier par morceaux de 8 Mio. Chaque morceau est relu par plage d'octets (Range) dans le stockage privé, à partir de l'URL
//      signée : la mémoire du worker reste bornée, quelle que soit la taille de la vidéo.
//   3. Au dernier octet, YouTube répond 200/201 avec la vidéo créée.
//
// Tant que le dernier octet n'est pas arrivé, YouTube ne crée RIEN : une coupure avant la fin est un refus sûr (on peut reprogrammer). Seul le dernier
// morceau laisse une issue incertaine (la vidéo est peut-être créée alors que la réponse s'est perdue) : on interroge d'abord la session, qui répond
// « terminé » avec la vidéo si elle existe, et sinon on ne rejoue pas : « issue inconnue », que l'utilisateur vérifie.
//
// Visibilité : PRIVÉE par défaut. Un projet Google non audité voit de toute façon ses vidéos verrouillées en privé par YouTube ; tant que l'audit de
// l'API n'est pas passé, on ne propose pas autre chose (YOUTUBE_PRIVACY=unlisted|public le permettra ensuite).
// ⚠️ Non validé contre l'API réelle.

export const YOUTUBE_MAX_TITLE = 100;
export const YOUTUBE_MAX_DESCRIPTION_BYTES = 5000;
/** Taille d'un morceau : le protocole exige un multiple de 256 Kio. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_FAILURES = 4;
const CATEGORY_PEOPLE_AND_BLOGS = '22';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const ASK_AGAIN = 'Rien n’a été publié : vous pouvez reprogrammer.';

export type YouTubePrivacy = 'private' | 'unlisted' | 'public';

/** Visibilité demandée à YouTube : privée, sauf si YOUTUBE_PRIVACY dit explicitement « unlisted » ou « public ». */
export function youtubePrivacy(env: Env): YouTubePrivacy {
  const v = String(env.YOUTUBE_PRIVACY ?? '').trim().toLowerCase();
  return v === 'public' || v === 'unlisted' ? v : 'private';
}

/** YouTube refuse « < » et « > » dans le titre et la description. */
const stripAngles = (s: string) => s.replace(/[<>]/g, '');

/** Titre : la première ligne non vide du texte (100 caractères au plus) ; à défaut, le nom du fichier sans son extension. */
export function youtubeTitle(content: string, fileName: string): string {
  const line = content.split(/\r?\n/).map((l) => stripAngles(l).replace(/\s+/g, ' ').trim()).find((l) => l !== '');
  const fallback = stripAngles(fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...(line ?? (fallback || 'Vidéo'))].slice(0, YOUTUBE_MAX_TITLE).join('').trimEnd();
}

/** Description : tout le texte, coupé à 5 000 octets (la limite de YouTube compte des octets UTF-8, pas des caractères), sans casser un caractère. */
export function youtubeDescription(content: string): string {
  const clean = stripAngles(content).trim();
  const enc = new TextEncoder();
  if (enc.encode(clean).length <= YOUTUBE_MAX_DESCRIPTION_BYTES) return clean;
  let bytes = 0;
  let out = '';
  for (const ch of clean) {
    bytes += enc.encode(ch).length;
    if (bytes > YOUTUBE_MAX_DESCRIPTION_BYTES) break;
    out += ch;
  }
  return out.trimEnd();
}

/** Explications des refus de YouTube que l'utilisateur peut comprendre (le texte de Google est en anglais et technique). */
function friendly(e: PublishRejectedError, now: Date): PublishRejectedError {
  const m = e.message.toLowerCase();
  if (e.status === 403 && /quota/.test(m)) {
    // Le quota de YouTube se renouvelle à minuit, heure du Pacifique : le moteur reporte la publication à cet instant (plus une marge).
    return new QuotaExceededError('Le quota quotidien de l’API YouTube est épuisé (il se renouvelle chaque jour). Rien n’a été publié.', new Date(nextPacificMidnight(now).getTime() + QUOTA_MARGIN_MS), 403);
  }
  if (/upload ?limit|number of videos they may upload/.test(m)) return new PublishRejectedError(`YouTube a atteint la limite d’envois de cette chaîne : réessayez plus tard. ${ASK_AGAIN}`, e.status);
  if (/signup|channel not found|no channel/.test(m)) return new PublishRejectedError('Ce compte Google n’a pas de chaîne YouTube.', e.status);
  if (e.status === 403 && /permission|scope|forbidden/.test(m)) return new PublishRejectedError('YouTube refuse l’envoi : reconnectez le canal pour accorder l’autorisation d’envoyer des vidéos.', 403);
  return e;
}

/** `Range: bytes=0-N` d'une réponse « 308 reprise » → premier octet à envoyer ensuite (0 si YouTube n'a encore rien reçu). */
export function nextOffset(range: string | null): number {
  const m = /bytes=0-(\d+)/.exec(range ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

export interface YouTubeOptions {
  sleep?: (ms: number) => Promise<void>;
  chunkBytes?: number;
  /** Durée maximale d'une requête d'envoi (un morceau de 8 Mio). */
  chunkTimeoutMs?: number;
  /** Horloge, pour calculer le renouvellement du quota. */
  now?: () => Date;
}

type Step = { kind: 'done'; id: string } | { kind: 'next'; next: number } | { kind: 'retry' };

export const createYouTubeProvider = (fetchImpl: Fetch = fetch, env: Env = process.env, opts: YouTubeOptions = {}): SocialProvider => {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chunkBytes = opts.chunkBytes ?? YOUTUBE_CHUNK_BYTES;
  const chunkTimeoutMs = opts.chunkTimeoutMs ?? 120_000;
  const now = opts.now ?? (() => new Date());

  /** Taille du fichier : celle de la bibliothèque, sinon lue dans la réponse à une lecture d'un seul octet. */
  async function sizeOf(media: ResolvedMedia): Promise<number> {
    if (media.sizeBytes && media.sizeBytes > 0) return media.sizeBytes;
    try {
      const res = await fetchImpl(media.url, { headers: { Range: 'bytes=0-0' } });
      const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1];
      if (total && Number(total) > 0) return Number(total);
    } catch {
      /* traité ci-dessous */
    }
    throw new PublishRejectedError(`La taille de la vidéo « ${media.name} » est inconnue. ${ASK_AGAIN}`);
  }

  /** Relit les octets [start, end] du fichier dans le stockage. Un échec ici est sûr : rien n'est créé chez YouTube avant le dernier octet. */
  async function readRange(media: ResolvedMedia, start: number, end: number): Promise<Uint8Array> {
    const expected = end - start + 1;
    let res: Response;
    try {
      res = await fetchImpl(media.url, { headers: { Range: `bytes=${start}-${end}` } });
    } catch (e) {
      throw new PublishRejectedError(`La vidéo « ${media.name} » n’a pas pu être relue dans le stockage (${(e as Error).message}). ${ASK_AGAIN}`);
    }
    if (res.status !== 206 && !(res.status === 200 && start === 0)) {
      throw new PublishRejectedError(`Le stockage n’a pas fourni la vidéo « ${media.name} » (réponse ${res.status}). ${ASK_AGAIN}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (bytes.length !== expected) {
      throw new PublishRejectedError(`La vidéo « ${media.name} » n’est pas lisible par morceaux (${bytes.length} octets reçus au lieu de ${expected}). ${ASK_AGAIN}`);
    }
    return bytes;
  }

  /** Une requête PUT sur la session d'envoi, avec délai maximal. Renvoie `null` sur une panne réseau (à réessayer). */
  async function put(sessionUrl: string, token: string, headers: Record<string, string>, body?: Uint8Array): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), chunkTimeoutMs);
    try {
      return await fetchImpl(sessionUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, ...headers }, body: body as RequestInit['body'], signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const videoId = async (res: Response): Promise<string | null> => {
    try {
      const id = (JSON.parse(await res.text()) as { id?: unknown }).id;
      return typeof id === 'string' && id ? id : null;
    } catch {
      return null;
    }
  };

  /** Où en est l'envoi ? « terminé » (avec la vidéo), « reprendre à tel octet », ou `null` (YouTube ne répond pas). */
  async function status(sessionUrl: string, token: string, size: number): Promise<{ id: string } | { next: number } | null> {
    const res = await put(sessionUrl, token, { 'Content-Range': `bytes */${size}` });
    if (!res) return null;
    if (res.status === 200 || res.status === 201) {
      const id = await videoId(res);
      return id ? { id } : null;
    }
    if (res.status === 308) return { next: nextOffset(res.headers.get('range')) };
    return null;
  }

  async function sendChunk(sessionUrl: string, token: string, media: ResolvedMedia, bytes: Uint8Array, start: number, size: number, mime: string): Promise<Step> {
    const end = start + bytes.length - 1;
    const res = await put(sessionUrl, token, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Type': mime }, bytes);
    if (!res) return { kind: 'retry' };
    if (res.status === 200 || res.status === 201) {
      const id = await videoId(res);
      return id ? { kind: 'done', id } : { kind: 'retry' }; // créée, mais réponse illisible : la session le confirmera
    }
    if (res.status === 308) return { kind: 'next', next: nextOffset(res.headers.get('range')) };
    if (res.status === 401) throw new ReconnectRequiredError();
    if (res.status === 404 || res.status === 410) throw new PublishRejectedError(`La session d’envoi vers YouTube a expiré. ${ASK_AGAIN}`, res.status);
    if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: 'retry' };
    const detail = await res.text().then((t) => (JSON.parse(t) as any)?.error?.message).catch(() => undefined);
    throw friendly(new PublishRejectedError(`YouTube a refusé la vidéo « ${media.name} »${detail ? ` : ${String(detail).slice(0, 300)}` : ` (${res.status})`}.`, res.status), now());
  }

  async function upload(sessionUrl: string, token: string, media: ResolvedMedia, size: number, mime: string): Promise<string> {
    let offset = 0;
    let failures = 0;
    let triedFinal = false;
    for (;;) {
      if (offset >= size) {
        // Tous les octets sont partis sans réponse « terminé » : on demande à YouTube où il en est.
        const s = await status(sessionUrl, token, size);
        if (s && 'id' in s) return s.id;
        if (s && s.next < size) {
          offset = s.next;
          continue;
        }
        throw new OutcomeUnknownError('YouTube n’a pas confirmé la création de la vidéo. Vérifiez dans YouTube Studio avant de republier.');
      }

      const end = Math.min(offset + chunkBytes, size) - 1;
      if (end === size - 1) triedFinal = true;
      const bytes = await readRange(media, offset, end);
      const step = await sendChunk(sessionUrl, token, media, bytes, offset, size, mime);
      if (step.kind === 'done') return step.id;
      if (step.kind === 'next') {
        if (step.next > offset) failures = 0;
        else failures++;
        offset = step.next;
      } else {
        failures++;
      }

      if (failures > MAX_FAILURES) {
        if (triedFinal) {
          throw new OutcomeUnknownError('L’envoi vers YouTube s’est interrompu à la fin : la vidéo est peut-être créée. Vérifiez dans YouTube Studio avant de republier.');
        }
        throw new PublishRejectedError(`L’envoi de la vidéo vers YouTube s’est interrompu. ${ASK_AGAIN}`);
      }
      if (step.kind === 'retry') {
        await sleep(1000 * 2 ** (failures - 1));
        const s = await status(sessionUrl, token, size); // le morceau est-il arrivé malgré tout ? la vidéo est-elle déjà créée ?
        if (s && 'id' in s) return s.id;
        if (s) offset = s.next;
      }
    }
  }

  return {
    id: 'youtube',
    supportsThreads: false,
    supportsMedia: true,
    refreshToken: oauthRefresher('google', fetchImpl, env),
    metrics: youtubeMetrics(fetchImpl),

    async publish({ accessToken, posts }) {
      const post = posts[0]!;
      const videos = post.media.filter((m) => m.kind === 'video');
      if (post.media.length === 0) throw new PublishRejectedError('YouTube exige une vidéo.');
      if (videos.length !== 1 || post.media.length !== 1) throw new PublishRejectedError('YouTube publie une seule vidéo à la fois, sans autre média.');
      const media = videos[0]!;
      const mime = media.mimeType?.startsWith('video/') ? media.mimeType : 'application/octet-stream';
      const size = await sizeOf(media);

      // 1. Session d'envoi. Une issue incertaine ici n'est pas un risque de doublon (aucun octet n'est parti) : refus sûr.
      let sessionUrl: string | null;
      try {
        const res = await mutate(
          fetchImpl,
          UPLOAD_URL,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Length': String(size),
              'X-Upload-Content-Type': mime,
            },
            body: JSON.stringify({
              snippet: { title: youtubeTitle(post.content, media.name), description: youtubeDescription(post.content), categoryId: CATEGORY_PEOPLE_AND_BLOGS },
              status: { privacyStatus: youtubePrivacy(env), selfDeclaredMadeForKids: false },
            }),
          },
          { provider: 'YouTube' }
        );
        sessionUrl = res.headers.get('location');
      } catch (e) {
        if (e instanceof OutcomeUnknownError) throw new PublishRejectedError(`YouTube n’a pas répondu à temps. ${ASK_AGAIN}`);
        if (e instanceof PublishRejectedError) throw friendly(e, now());
        throw e;
      }
      if (!sessionUrl) throw new PublishRejectedError(`YouTube n’a pas ouvert de session d’envoi. ${ASK_AGAIN}`);

      // 2 et 3. Envoi du fichier.
      const id = await upload(sessionUrl, accessToken, media, size, mime);
      return [{ releaseId: id, releaseUrl: `https://www.youtube.com/watch?v=${id}` }];
    },
  };
};
