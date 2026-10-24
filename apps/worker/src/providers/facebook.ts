import { OutcomeUnknownError, PublishRejectedError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import { facebookMetrics } from './insights/facebook.ts';
import { GRAPH_VERSION as VERSION } from './meta.ts';
import type { ResolvedMedia, SocialProvider } from './types.ts';

export const FACEBOOK_MAX_PHOTOS = 10;
const ALT_MAX = 1000;

// Publication sur une Page Facebook : texte seul (/feed), une photo (/photos), plusieurs photos (chaque photo envoyée sans être publiée, puis un post
// qui les rassemble), ou une vidéo (/videos). Meta télécharge les fichiers elle-même depuis des URL signées temporaires.
// ⚠️ Non validé contre l'API réelle : à tester avec une Page de test avant la revue Meta.
export const createFacebookProvider = (fetchImpl: Fetch = fetch): SocialProvider => {
  const headers = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

  /** Envoi d'une photo non publiée : invisible tant que le post final n'existe pas, donc une panne reste un refus sûr (on peut reprogrammer). */
  async function uploadHiddenPhoto(page: string, token: string, m: ResolvedMedia): Promise<string> {
    const alt = m.alt.trim().slice(0, ALT_MAX);
    try {
      const res = await mutate(
        fetchImpl, `https://graph.facebook.com/${VERSION}/${page}/photos`,
        { method: 'POST', headers: headers(token), body: JSON.stringify({ url: m.url, published: false, ...(alt ? { alt_text_custom: alt } : {}) }) },
        { provider: 'Facebook' }
      );
      const id = res.json?.id as string | undefined;
      if (!id) throw new PublishRejectedError(`Facebook n’a pas enregistré la photo « ${m.name} ». Rien n’a été publié : vous pouvez reprogrammer.`);
      return id;
    } catch (e) {
      if (e instanceof OutcomeUnknownError) throw new PublishRejectedError('Facebook n’a pas répondu à temps pendant l’envoi des photos. Rien n’a été publié : vous pouvez reprogrammer.');
      throw e;
    }
  }

  return {
    id: 'facebook',
    supportsThreads: false,
    supportsMedia: true,
    metrics: facebookMetrics(fetchImpl),
    async publish({ accessToken, integration, posts }) {
      const post = posts[0]!;
      const page = integration.internalId;
      const media = post.media;
      const videos = media.filter((m) => m.kind === 'video');
      if (media.length > FACEBOOK_MAX_PHOTOS) throw new PublishRejectedError(`Une publication Facebook contient ${FACEBOOK_MAX_PHOTOS} photos au plus.`);
      if (videos.length > 1) throw new PublishRejectedError('Une publication Facebook ne peut contenir qu’une seule vidéo.');
      if (videos.length === 1 && media.length > 1) throw new PublishRejectedError('Facebook ne mélange pas photos et vidéo dans une même publication.');

      // Vidéo
      if (videos.length === 1) {
        const res = await mutate(
          fetchImpl, `https://graph-video.facebook.com/${VERSION}/${page}/videos`,
          { method: 'POST', headers: headers(accessToken), body: JSON.stringify({ file_url: videos[0]!.url, description: post.content }) },
          { provider: 'Facebook' }
        );
        const id = res.json?.id as string | undefined;
        if (!id) throw new OutcomeUnknownError('Facebook n’a pas renvoyé d’identifiant de vidéo. Vérifiez sur la Page avant de republier.');
        return [{ releaseId: id, releaseUrl: `https://www.facebook.com/${id}` }];
      }

      // Une photo : un seul appel, publié tout de suite avec sa légende.
      if (media.length === 1) {
        const m = media[0]!;
        const alt = m.alt.trim().slice(0, ALT_MAX);
        const res = await mutate(
          fetchImpl, `https://graph.facebook.com/${VERSION}/${page}/photos`,
          { method: 'POST', headers: headers(accessToken), body: JSON.stringify({ url: m.url, caption: post.content, published: true, ...(alt ? { alt_text_custom: alt } : {}) }) },
          { provider: 'Facebook' }
        );
        // `post_id` désigne la publication (celle qu'on commente) ; `id` n'est que la photo.
        const id = (res.json?.post_id ?? res.json?.id) as string | undefined;
        if (!id) throw new OutcomeUnknownError('Facebook n’a pas renvoyé d’identifiant de publication. Vérifiez sur la Page avant de republier.');
        return [{ releaseId: id, releaseUrl: `https://www.facebook.com/${id}` }];
      }

      // Plusieurs photos : chacune est d'abord envoyée sans être publiée, puis un seul post les rassemble.
      const body: Record<string, unknown> = { message: post.content };
      if (media.length > 1) {
        const ids: string[] = [];
        for (const m of media) ids.push(await uploadHiddenPhoto(page, accessToken, m));
        body.attached_media = ids.map((id) => ({ media_fbid: id }));
      }
      const res = await mutate(
        fetchImpl, `https://graph.facebook.com/${VERSION}/${page}/feed`,
        { method: 'POST', headers: headers(accessToken), body: JSON.stringify(body) },
        { provider: 'Facebook' }
      );
      const id = res.json?.id as string | undefined;
      if (!id) throw new OutcomeUnknownError('Facebook n’a pas renvoyé d’identifiant de publication. Vérifiez sur la Page avant de republier.');
      return [{ releaseId: id, releaseUrl: `https://www.facebook.com/${id}` }];
    },
    async comment({ accessToken, releaseId, text }) {
      const res = await mutate(
        fetchImpl,
        `https://graph.facebook.com/${VERSION}/${releaseId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ message: text }),
        },
        { provider: 'Facebook', subject: 'comment' }
      );
      const id = res.json?.id as string | undefined;
      if (!id) throw new OutcomeUnknownError('Facebook n’a pas renvoyé d’identifiant de commentaire. Vérifiez sous la publication avant de recommenter.');
      return { commentId: id };
    },
  };
};
