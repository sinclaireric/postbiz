import OpenAI from 'openai';
import { imageModel, imageQuality } from './config';
import type { VideoOrientation } from './types';

/**
 * Les fournisseurs de génération, derrière deux petites interfaces pour pouvoir les remplacer dans les tests et en démo.
 * Images : l'API d'images d'OpenAI (`chatgpt-image-latest`, comme Postiz). Vidéos : Seedance 2.0 par Evolink (comme Postiz), une tâche
 * qu'on lance puis qu'on interroge, car elle dure plusieurs minutes.
 */

export type ImageSize = 'square' | 'landscape' | 'portrait';

export const IMAGE_SIZES: Record<ImageSize, { api: '1024x1024' | '1536x1024' | '1024x1536'; width: number; height: number }> = {
  square: { api: '1024x1024', width: 1024, height: 1024 },
  landscape: { api: '1536x1024', width: 1536, height: 1024 },
  portrait: { api: '1024x1536', width: 1024, height: 1536 },
};

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export interface ImageProvider {
  generate(prompt: string, size: ImageSize, signal?: AbortSignal): Promise<GeneratedImage>;
}

/** Une image trop longue à venir est abandonnée avant la fin de la réponse (60 s) : mieux vaut une erreur claire qu'une réponse coupée par la plateforme. */
const IMAGE_TIMEOUT_MS = 45_000;

export function sdkImageProvider(make: () => OpenAI = () => new OpenAI({ timeout: IMAGE_TIMEOUT_MS, maxRetries: 0 })): ImageProvider {
  // Le client n'est créé qu'au premier appel : le SDK refuse de se construire sans clé, et cette fabrique sert aussi à interroger des vidéos.
  let client: OpenAI | undefined;
  return {
    async generate(prompt, size, signal) {
      const { api, width, height } = IMAGE_SIZES[size];
      // Les modèles gpt-image rendent toujours du base64 et refusent `response_format`. JPEG : Instagram n'accepte que lui, et c'est plus léger.
      const result = await (client ??= make()).images.generate({ model: imageModel(), prompt, size: api, quality: imageQuality(), output_format: 'jpeg', n: 1 }, { signal });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error('no image returned');
      return { bytes: Uint8Array.from(Buffer.from(b64, 'base64')), mimeType: 'image/jpeg', width, height };
    },
  };
}

export type VideoCheck = { state: 'pending' } | { state: 'completed'; url: string } | { state: 'failed'; error: string };

export interface VideoProvider {
  /** Lance la génération ; rend l'identifiant de la tâche chez le fournisseur. */
  start(input: { prompt: string; orientation: VideoOrientation; imageUrls: string[] }, signal?: AbortSignal): Promise<string>;
  check(taskId: string, signal?: AbortSignal): Promise<VideoCheck>;
}

/** Ce que Seedance produit (720p, 8 secondes) : les valeurs demandées au fournisseur, que l'on garde dans la médiathèque. */
export const VIDEO_FORMAT = { durationSeconds: 8, vertical: { width: 720, height: 1280 }, horizontal: { width: 1280, height: 720 } } as const;

const EVOLINK = 'https://api.evolink.ai/v1';

function describeError(value: unknown): string | null {
  const e = (value as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (!e) return null;
  return [e.code, e.message].filter((x): x is string => typeof x === 'string' && x !== '').join(': ').slice(0, 300) || null;
}

/** Seedance 2.0 (Evolink), avec les mêmes paramètres que Postiz : modèle « fast », 8 s, 720p, son généré ; « reference-to-video » quand on donne des images. */
export function evolinkVideoProvider(fetcher: typeof fetch = fetch): VideoProvider {
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EVOLINK_API_KEY?.trim() ?? ''}` });
  const timeout = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000));
  return {
    async start({ prompt, orientation, imageUrls }, signal) {
      const res = await fetcher(`${EVOLINK}/videos/generations`, {
        method: 'POST', headers: headers(), signal: timeout(signal),
        body: JSON.stringify({
          model: imageUrls.length ? 'seedance-2.0-fast-reference-to-video' : 'seedance-2.0-fast-text-to-video',
          prompt,
          ...(imageUrls.length ? { image_urls: imageUrls } : {}),
          aspect_ratio: orientation === 'horizontal' ? '16:9' : '9:16',
          duration: VIDEO_FORMAT.durationSeconds, quality: '720p', generate_audio: true,
        }),
      });
      const value = (await res.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof value?.id !== 'string' || !value.id) throw new Error(describeError(value) ?? `video provider answered ${res.status}`);
      return value.id;
    },

    async check(taskId, signal) {
      const res = await fetcher(`${EVOLINK}/tasks/${encodeURIComponent(taskId)}`, { headers: headers(), signal: timeout(signal) });
      const data = (await res.json().catch(() => null)) as { status?: unknown; results?: unknown } | null;
      if (!data) throw new Error(`video provider answered ${res.status}`);
      if (data.status === 'completed') {
        const url = Array.isArray(data.results) ? data.results.find((r): r is string => typeof r === 'string' && r !== '') : undefined;
        return url ? { state: 'completed', url } : { state: 'failed', error: 'The provider finished without returning a video.' };
      }
      if (data.status === 'pending' || data.status === 'processing') return { state: 'pending' };
      return { state: 'failed', error: describeError(data) ?? `Video generation failed (status ${String(data.status)}).` };
    },
  };
}

/** Ce que le modèle apprend d'un échec d'image : une phrase utile (refus de contenu, compte, délai), sans réponse brute du fournisseur. */
export function explainImageError(error: unknown): string {
  if (error instanceof OpenAI.BadRequestError && (error.code === 'moderation_blocked' || error.code === 'content_policy_violation')) {
    return 'The image provider refused this description (content policy). Tell the user, and offer a different idea; do not retry the same description.';
  }
  if (error instanceof OpenAI.RateLimitError && error.code === 'insufficient_quota') return 'The image provider account has no credit left. Tell the user an administrator must check the OpenAI billing.';
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return 'The image provider rejected the server key or the organization has no access to the image model. Tell the user an administrator must check the OpenAI settings.';
  if (error instanceof OpenAI.RateLimitError) return 'The image provider is busy. Tell the user to try again in a minute.';
  if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIUserAbortError || (error instanceof DOMException && error.name === 'AbortError')) {
    return 'The picture took too long and was abandoned. Tell the user to try again, with a simpler description.';
  }
  return 'The image provider failed. Tell the user to try again later.';
}
