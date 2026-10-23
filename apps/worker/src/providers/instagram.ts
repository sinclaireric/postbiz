import type { Env } from '@postbiz/core';
import { OutcomeUnknownError, PublishRejectedError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import { GRAPH_VERSION, graphHost } from './meta.ts';
import { oauthRefresher } from './oauth.ts';
import type { ResolvedMedia, SocialProvider } from './types.ts';

// Publication sur Instagram (connexion par Page : graph.facebook.com ; connexion Instagram Login : graph.instagram.com, voir settings.graph_host).
// Une publication se fait en trois temps, comme le décrit l'API « Content Publishing » :
//   1. on crée un « conteneur » par média (image ou vidéo), avec l'adresse du fichier que Meta télécharge lui-même ;
//   2. on attend que chaque conteneur soit « FINISHED » (Meta traite la vidéo) ; pour un carrousel, on crée ensuite le conteneur du carrousel ;
//   3. on publie le conteneur (`media_publish`).
// Tant que l'étape 3 n'a pas eu lieu, RIEN n'est visible : un échec aux étapes 1 et 2 est un refus sûr (on peut reprogrammer). Seule l'étape 3 peut laisser
// une issue incertaine (réponse perdue après coup) : elle n'est jamais rejouée.
// ⚠️ Non validé contre l'API réelle.

export interface InstagramOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Intervalle entre deux vérifications d'un conteneur. */
  pollMs?: number;
  /** Attente maximale du traitement d'une image / d'une vidéo. */
  imageWaitMs?: number;
  videoWaitMs?: number;
}

export const INSTAGRAM_MAX_CAPTION = 2200;
export const INSTAGRAM_MAX_ALT = 1000;
export const INSTAGRAM_MAX_CAROUSEL = 10;

const ASK_AGAIN = 'Rien n’a été publié : vous pouvez reprogrammer.';

export const createInstagramProvider = (fetchImpl: Fetch = fetch, env: Env = process.env, opts: InstagramOptions = {}): SocialProvider => {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 4_000;
  const imageWaitMs = opts.imageWaitMs ?? 60_000;
  const videoWaitMs = opts.videoWaitMs ?? 5 * 60_000;

  /** Étapes 1 et 2 : l'issue incertaine d'une requête n'est pas un risque de doublon (rien n'est visible), donc un refus sûr. */
  async function step(url: string, token: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    try {
      const res = await mutate(fetchImpl, url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }, { provider: 'Instagram' });
      return res.json ?? {};
    } catch (e) {
      if (e instanceof OutcomeUnknownError) throw new PublishRejectedError(`Instagram n’a pas répondu à temps. ${ASK_AGAIN}`);
      throw e;
    }
  }

  /** Attend qu'un conteneur soit prêt. Lève un refus (rien de publié) s'il échoue, expire, ou met trop de temps. */
  async function waitFinished(base: string, token: string, containerId: string, kind: 'image' | 'video'): Promise<void> {
    const budget = kind === 'video' ? videoWaitMs : imageWaitMs;
    let waited = 0;
    let failures = 0;
    for (;;) {
      let status: string | undefined;
      let detail: string | undefined;
      try {
        const res = await fetchImpl(`${base}/${containerId}?fields=status_code,status`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`réponse ${res.status}`);
        status = json.status_code;
        detail = typeof json.status === 'string' ? json.status : undefined;
        failures = 0;
      } catch {
        if (++failures >= 3) throw new PublishRejectedError(`Instagram ne répond plus : impossible de vérifier le traitement du média. ${ASK_AGAIN}`);
      }
      if (status === 'FINISHED' || status === 'PUBLISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new PublishRejectedError(`Instagram n’a pas pu traiter le média${detail ? ` : ${detail.slice(0, 200)}` : ''}. Vérifiez son format (JPEG pour une image ; MP4 H.264 pour une vidéo) puis reprogrammez.`);
      }
      if (waited >= budget) throw new PublishRejectedError(`Instagram met trop de temps à traiter le média. ${ASK_AGAIN}`);
      await sleep(pollMs);
      waited += pollMs;
    }
  }

  const imageUrl = (m: ResolvedMedia): string => {
    const url = m.jpegUrl ?? (m.mimeType === 'image/jpeg' ? m.url : null);
    if (!url) {
      throw new PublishRejectedError(`L’image « ${m.name} » n’est pas au format JPEG, le seul qu’Instagram accepte, et aucune version JPEG n’a pu être créée. Envoyez-la de nouveau en JPEG.`);
    }
    return url;
  };

  return {
    id: 'instagram',
    supportsThreads: false,
    supportsMedia: true,
    refreshToken: oauthRefresher('instagram_login', fetchImpl, env),

    async publish({ accessToken, integration, posts }) {
      const post = posts[0]!;
      const media = post.media;
      if (media.length === 0) throw new PublishRejectedError('Instagram exige au moins une image ou une vidéo.');
      if (media.length > INSTAGRAM_MAX_CAROUSEL) throw new PublishRejectedError(`Un carrousel Instagram contient ${INSTAGRAM_MAX_CAROUSEL} médias au plus.`);
      if ([...post.content].length > INSTAGRAM_MAX_CAPTION) throw new PublishRejectedError(`La légende dépasse ${INSTAGRAM_MAX_CAPTION} caractères, la limite d’Instagram.`);
      const urls = media.map((m) => (m.kind === 'image' ? imageUrl(m) : m.url)); // vérifie les images avant tout appel réseau

      const base = `https://${graphHost(integration.settings)}/${GRAPH_VERSION}`;
      const igId = String(integration.settings.ig_user_id ?? integration.internalId);
      const carousel = media.length > 1;
      const caption = post.content;

      // 1. un conteneur par média
      const containers: string[] = [];
      for (const [i, m] of media.entries()) {
        const alt = m.alt.trim().slice(0, INSTAGRAM_MAX_ALT);
        const body: Record<string, unknown> =
          m.kind === 'image'
            ? { image_url: urls[i], ...(alt ? { alt_text: alt } : {}), ...(carousel ? { is_carousel_item: true } : { caption }) }
            : carousel
              ? { media_type: 'VIDEO', video_url: urls[i], is_carousel_item: true }
              : { media_type: 'REELS', video_url: urls[i], caption, share_to_feed: true };
        const json = await step(`${base}/${igId}/media`, accessToken, body);
        if (typeof json.id !== 'string' || !json.id) throw new PublishRejectedError(`Instagram n’a pas créé le conteneur du média « ${m.name} ». ${ASK_AGAIN}`);
        containers.push(json.id);
      }

      // 2. attente du traitement (images : quelques secondes ; vidéos : parfois plusieurs minutes)
      for (const [i, id] of containers.entries()) await waitFinished(base, accessToken, id, media[i]!.kind);

      let creationId = containers[0]!;
      if (carousel) {
        const json = await step(`${base}/${igId}/media`, accessToken, { media_type: 'CAROUSEL', children: containers.join(','), caption });
        if (typeof json.id !== 'string' || !json.id) throw new PublishRejectedError(`Instagram n’a pas créé le carrousel. ${ASK_AGAIN}`);
        creationId = json.id;
        await waitFinished(base, accessToken, creationId, media.some((m) => m.kind === 'video') ? 'video' : 'image');
      }

      // 3. publication : jamais rejouée si l'issue est incertaine (OutcomeUnknownError remonte telle quelle)
      const res = await mutate(
        fetchImpl, `${base}/${igId}/media_publish`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ creation_id: creationId }) },
        { provider: 'Instagram' }
      );
      const mediaId = res.json?.id as string | undefined;
      if (!mediaId) throw new OutcomeUnknownError('Instagram n’a pas renvoyé d’identifiant de publication. Vérifiez sur le compte avant de republier.');

      let permalink: string | null = null;
      try {
        const info = await fetchImpl(`${base}/${mediaId}?fields=permalink`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
        const json: any = await info.json().catch(() => ({}));
        if (info.ok && typeof json.permalink === 'string') permalink = json.permalink;
      } catch {
        /* le lien est un confort : la publication a eu lieu */
      }
      return [{ releaseId: mediaId, releaseUrl: permalink }];
    },
  };
};
