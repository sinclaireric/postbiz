import OpenAI from 'openai';
import type { GenerationRepository, MediaItem, MediaRepository, VideoJobRecord } from '@/lib/data/types';
import { explainImageError, VIDEO_FORMAT, type ImageProvider, type ImageSize, type VideoProvider } from './generate';
import { publicJob } from './job';
import { AGENT_LIMITS, type AgentVideoJob, type VideoOrientation } from './types';

/**
 * Générer des images et des vidéos pour les publications, comme dans Postiz (outils `generateImageTool`, `generateVideoTool` et `videoStatusTool`).
 * L'image arrive dans la réponse de l'agent ; la vidéo prend plusieurs minutes : on la lance, on garde sa tâche (`ai_video_jobs`), puis le navigateur
 * ou le mobile l'interroge (`advanceVideoJob`) jusqu'à ce qu'elle soit enregistrée dans la médiathèque. Rien ne passe par une autre voie que les
 * dépôts de l'utilisateur connecté, et chaque génération est comptée dans un plafond journalier par organisation.
 */

export interface GenerationLimits {
  imagesPerDay: number;
  videosPerDay: number;
}

export type ImageResult = { ok: true; item: MediaItem } | { ok: false; error: string };
export type VideoStartResult = { ok: true; job: AgentVideoJob } | { ok: false; error: string };
export type VideoStatusResult = { ok: true; job: AgentVideoJob; item: MediaItem | null } | { ok: false; error: string };

/** Ce que l'agent peut lancer. Les messages d'erreur s'adressent au modèle (en anglais) : il les reformule pour l'utilisateur. */
export interface GenerationTools {
  generateImage(args: { prompt: string; size: ImageSize; alt?: string }): Promise<ImageResult>;
  startVideo(args: { prompt: string; orientation: VideoOrientation; referenceIds: string[] }): Promise<VideoStartResult>;
  videoStatus(jobId: string): Promise<VideoStatusResult>;
}

export interface GenerationDeps {
  repos: { generation: GenerationRepository; media: Pick<MediaRepository, 'byIds'> };
  /** Absent : la génération d'images n'est pas proposée. */
  images: ImageProvider | null;
  videos: VideoProvider | null;
  limits: GenerationLimits;
  /** Instant (ms) où la réponse en cours sera coupée par la plateforme : une image n'est pas lancée si elle risque de ne pas finir avant. */
  deadline?: number;
  now?: () => number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

/** Temps qu'il faut laisser à une image (qui peut durer une quarantaine de secondes) avant la fin de la réponse. */
const IMAGE_MIN_MS = 25_000;
/** Une prise en charge plus ancienne est considérée comme perdue (la requête qui téléchargeait la vidéo a été coupée) : une autre la reprend. */
const STALE_CLAIM_MS = 3 * 60_000;
/** Postiz abandonne une vidéo après 30 minutes ; nous aussi. */
export const VIDEO_TIMEOUT_MS = 30 * 60_000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 50_000;
const MAX_ACTIVE_VIDEOS = 3;

const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** « ai-image-lever-de-soleil » : un nom lisible dans la médiathèque, tiré de la description (lettres sans accent, chiffres, tirets). */
/** Le quota mensuel de l'offre est épuisé : dit à l'agent quoi répondre (l'offre se change depuis la page Facturation). */
const MONTHLY_LIMIT = (what: 'pictures' | 'videos') =>
  `This workspace used all the generated ${what} included in its plan this month. Tell the user they can upgrade their plan from the Billing page, or wait for next month.`;

export function mediaSlug(prompt: string, fallback: string): string {
  const full = prompt.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // Coupé à un tiret plutôt qu'au milieu d'un mot.
  const slug = full.length <= 40 ? full : full.slice(0, 40).replace(/-[^-]*$/, '') || full.slice(0, 40);
  return `ai-${fallback}-${slug || fallback}`;
}

const no = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function createGenerationTools(deps: GenerationDeps): GenerationTools {
  const now = deps.now ?? Date.now;
  const { generation } = deps.repos;

  return {
    async generateImage({ prompt, size, alt }) {
      if (!deps.images) return no('Picture generation is not available on this server.');
      const text = prompt.trim().slice(0, AGENT_LIMITS.generationPrompt);
      if (!text) return no('The description of the picture is empty.');
      if (deps.deadline && now() > deps.deadline - IMAGE_MIN_MS) return no('Not enough time is left in this request to generate a picture. Tell the user to ask again in a new message.');
      const imageSlot = await generation.reserve('image', deps.limits.imagesPerDay);
      if (imageSlot === 'monthly') return no(MONTHLY_LIMIT('pictures'));
      if (imageSlot !== true) return no(`This organization reached its limit of ${deps.limits.imagesPerDay} generated pictures per day. Tell the user to try again tomorrow.`);
      let image;
      try {
        image = await deps.images.generate(text, size, deps.signal);
      } catch (error) {
        console.error('[agent] image', error instanceof OpenAI.APIError ? `${error.status} ${String(error.code)}` : error instanceof Error ? error.name : 'erreur inconnue');
        return no(explainImageError(error));
      }
      const item = await generation.createMedia({ name: `${mediaSlug(text, 'image')}.jpg`, mimeType: image.mimeType, bytes: image.bytes, width: image.width, height: image.height, durationSeconds: null, alt: oneLine(alt ?? '', 1_500) });
      return item ? { ok: true, item } : no('The picture was generated but could not be saved in the media library. Tell the user to try again.');
    },

    async startVideo({ prompt, orientation, referenceIds }) {
      if (!deps.videos) return no('Video generation is not available on this server.');
      const text = prompt.trim().slice(0, AGENT_LIMITS.generationPrompt);
      if (!text) return no('The description of the video is empty.');
      // Les images de référence sont lues par le fournisseur à l'adresse signée (temporaire) du fichier : des images de la médiathèque seulement.
      const wanted = [...new Set(referenceIds)].slice(0, AGENT_LIMITS.videoReferences);
      const refs = wanted.length > 0 ? await deps.repos.media.byIds(wanted) : [];
      if (refs.length !== wanted.length || refs.some((m) => m.kind !== 'image' || !m.url)) return no('Reference pictures must be images of the media library (ids from list_media or generate_image).');
      if ((await generation.activeJobs()) >= MAX_ACTIVE_VIDEOS) return no(`${MAX_ACTIVE_VIDEOS} videos are already being generated for this user. Tell them to wait for one to finish.`);
      const videoSlot = await generation.reserve('video', deps.limits.videosPerDay);
      if (videoSlot === 'monthly') return no(MONTHLY_LIMIT('videos'));
      if (videoSlot !== true) return no(`This organization reached its limit of ${deps.limits.videosPerDay} generated videos per day. Tell the user to try again tomorrow.`);

      let taskId: string;
      try {
        taskId = await deps.videos.start({ prompt: text, orientation, imageUrls: refs.map((m) => m.url!) }, deps.signal);
      } catch (error) {
        console.error('[agent] video', error instanceof Error ? error.name : 'erreur inconnue');
        return no(`The video provider refused or failed to start the video${error instanceof Error && error.message ? `: ${oneLine(error.message, 200)}` : ''}. Tell the user.`);
      }
      const job = await generation.createJob({ prompt: text, orientation, providerTaskId: taskId, referenceMediaIds: refs.map((m) => m.id) });
      if (!job) {
        console.error('[agent] video lancée mais sa tâche n’a pas pu être enregistrée');
        return no('The video was started but could not be tracked. Tell the user to try again later.');
      }
      return { ok: true, job: publicJob(job) };
    },

    videoStatus: (jobId) => advanceVideoJob(deps, jobId),
  };
}

class PermanentDownloadError extends Error {}

/** Une adresse de téléchargement doit être publique, en HTTPS : pas d'adresse IP, pas de nom local. */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':') && !/(^|\.)(localhost|local|internal|lan|home)$/.test(host);
}

async function downloadVideo(url: string, fetcher: typeof fetch): Promise<Uint8Array> {
  if (!isPublicHttpsUrl(url)) throw new PermanentDownloadError('The provider returned an unusable video address.');
  const res = await fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  if (res.url && !isPublicHttpsUrl(res.url)) throw new PermanentDownloadError('The provider returned an unusable video address.');
  const type = res.headers.get('content-type') ?? '';
  if (type && !type.startsWith('video/') && !type.startsWith('application/octet-stream') && !type.startsWith('binary/')) throw new PermanentDownloadError('The provider returned a file that is not a video.');
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_VIDEO_BYTES) throw new PermanentDownloadError('The video is too large to be stored.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_VIDEO_BYTES) {
      await reader.cancel();
      throw new PermanentDownloadError('The video is too large to be stored.');
    }
    chunks.push(value);
  }
  if (size === 0) throw new Error('empty video');
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/**
 * Fait avancer une vidéo : interroge le fournisseur ; une vidéo terminée est téléchargée puis rangée dans la médiathèque. Appelée à chaque interrogation
 * (navigateur, mobile ou outil `video_status`), sans effet de bord tant que la vidéo n'est pas prête. Une seule requête enregistre la vidéo (`claimJob`) :
 * les autres rendent l'état courant. Un échec passager (réseau, stockage) laisse la tâche en attente ; une vidéo inutilisable la termine en échec.
 */
export async function advanceVideoJob(deps: GenerationDeps, jobId: string): Promise<VideoStatusResult> {
  const now = deps.now ?? Date.now;
  const { generation } = deps.repos;
  const [rec] = await generation.jobs([jobId]);
  if (!rec) return no('Video job not found.');

  const view = async (r: VideoJobRecord, item?: MediaItem | null): Promise<VideoStatusResult> =>
    ({ ok: true, job: publicJob(r), item: item !== undefined ? item : r.mediaId ? ((await deps.repos.media.byIds([r.mediaId]))[0] ?? null) : null });
  const fail = async (error: string): Promise<VideoStatusResult> => {
    await generation.settleJob(rec.id, { status: 'failed', error });
    return view({ ...rec, status: 'failed', error, claimedAt: null });
  };

  if (rec.status !== 'pending') return view(rec);
  if (rec.claimedAt && now() - Date.parse(rec.claimedAt) < STALE_CLAIM_MS) return view(rec); // une autre requête l'enregistre
  if (now() - Date.parse(rec.createdAt) > VIDEO_TIMEOUT_MS) return fail('The video took more than 30 minutes and was abandoned.');
  if (!deps.videos) return view(rec);

  let check;
  try {
    check = await deps.videos.check(rec.providerTaskId, deps.signal);
  } catch {
    return view(rec); // le fournisseur ne répond pas : la prochaine interrogation réessaiera
  }
  if (check.state === 'pending') return view(rec);
  if (check.state === 'failed') return fail(oneLine(check.error, 300));

  if (!(await generation.claimJob(rec.id, new Date(now() - STALE_CLAIM_MS).toISOString()))) return view(rec);
  try {
    const bytes = await downloadVideo(check.url, deps.fetcher ?? fetch);
    const size = VIDEO_FORMAT[rec.orientation];
    const item = await generation.createMedia({ name: `${mediaSlug(rec.prompt, 'video')}.mp4`, mimeType: 'video/mp4', bytes, width: size.width, height: size.height, durationSeconds: VIDEO_FORMAT.durationSeconds, alt: '' });
    if (!item) throw new Error('save');
    await generation.settleJob(rec.id, { status: 'completed', mediaId: item.id });
    return view({ ...rec, status: 'completed', mediaId: item.id, claimedAt: null }, item);
  } catch (error) {
    if (error instanceof PermanentDownloadError) return fail(error.message);
    await generation.settleJob(rec.id, { status: 'pending' });
    console.error('[agent] enregistrement de la vidéo différé', error instanceof Error ? error.message.slice(0, 80) : 'erreur inconnue');
    return view({ ...rec, claimedAt: null });
  }
}
