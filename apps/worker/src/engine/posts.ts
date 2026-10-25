import { OutcomeUnknownError, PublishRejectedError, QuotaExceededError, ReconnectRequiredError } from '../providers/errors.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ResolvedMedia } from '../providers/types.ts';
import type { WorkerDb, WorkerPost } from './db.ts';
import { MediaUnavailableError } from './media.ts';
import { MAX_QUOTA_TRIES, formatUtc } from './quota.ts';

export interface PostOutcome {
  postId: string;
  result: 'published' | 'error' | 'unknown' | 'rescheduled';
  message?: string;
}

/**
 * Publie un post déjà « réclamé » (état `publishing`, verrou posé par claim_due_posts).
 *
 * Règle centrale : on ne rejoue JAMAIS une publication dont l'issue est incertaine.
 *  - refus clair du réseau        → `error`   (rien n'est parti ; l'utilisateur peut réessayer)
 *  - issue inconnue / exception   → `unknown` (l'utilisateur vérifie sur le réseau d'abord)
 */
export async function processPost(deps: { db: WorkerDb; providers: ProviderRegistry }, post: WorkerPost): Promise<PostOutcome> {
  const { db, providers } = deps;

  const fail = async (state: 'error' | 'unknown', message: string, notifyTitle: string): Promise<PostOutcome> => {
    await db.markPostFailed(post.id, state, message);
    await db.notify({ userId: post.createdBy, orgId: post.orgId, type: `post_${state}`, title: notifyTitle, body: message, data: { postId: post.id } }).catch(() => {});
    return { postId: post.id, result: state, message };
  };

  try {
    const integration = await db.getIntegration(post.integrationId);
    if (!integration) return await fail('error', 'Le canal n’existe plus.', 'Publication impossible');
    if (integration.status !== 'active') return await fail('error', `Le canal « ${integration.name} » doit être reconnecté.`, 'Canal à reconnecter');

    const provider = providers(integration.provider);
    if (!provider) return await fail('error', `La publication sur ${integration.provider} n’est pas encore disponible.`, 'Réseau non disponible');

    const children = await db.getChildren(post.id);
    if (children.length > 0 && !provider.supportsThreads) {
      return await fail('error', 'Ce réseau ne prend pas encore en charge les fils de publications.', 'Publication impossible');
    }
    if (post.media.length > 0 && !provider.supportsMedia) {
      return await fail('error', 'L’envoi de médias n’est pas encore disponible pour ce réseau.', 'Publication impossible');
    }

    const accessToken = await db.getAccessToken(integration.id);
    if (!accessToken) {
      await db.markIntegrationRefreshNeeded(integration.id);
      return await fail('error', `Aucun accès valide pour « ${integration.name} » : reconnectez le canal.`, 'Canal à reconnecter');
    }

    // Médias : relus dans la bibliothèque avec des URL signées neuves. Rien n'a encore été envoyé au réseau : un échec ici est un simple « error ».
    const all = [post, ...children];
    let media: ResolvedMedia[][];
    try {
      media = await Promise.all(all.map((p) => db.resolveMedia(post.orgId, p.media)));
    } catch (e) {
      const message = e instanceof MediaUnavailableError ? e.message : `Les médias n’ont pas pu être préparés (${(e as Error).message}). Rien n’a été publié : reprogrammez la publication.`;
      return await fail('error', message, 'Publication impossible');
    }

    let results;
    try {
      results = await provider.publish({
        accessToken,
        integration: { id: integration.id, internalId: integration.internalId, settings: integration.settings },
        posts: all.map((p, i) => ({ id: p.id, content: p.content, media: media[i]!, settings: p.settings })),
      });
    } catch (e) {
      if (e instanceof ReconnectRequiredError) {
        await db.markIntegrationRefreshNeeded(integration.id);
        return await fail('error', e.message, 'Canal à reconnecter');
      }
      if (e instanceof QuotaExceededError) {
        // Quota épuisé : rien n'est parti, donc on peut remettre en file pour le renouvellement du quota sans risque de doublon, quelques fois seulement.
        if (post.attempts >= MAX_QUOTA_TRIES) return await fail('error', `${e.message} Plusieurs tentatives ont échoué : reprogrammez la publication.`, 'Publication refusée');
        const message = `${e.message} Reprogrammée automatiquement pour le ${formatUtc(e.retryAt)}.`;
        await db.reschedulePost(post.id, e.retryAt, message);
        await db.notify({ userId: post.createdBy, orgId: post.orgId, type: 'post_rescheduled', title: 'Publication reportée', body: message, data: { postId: post.id, publishAt: e.retryAt.toISOString() } }).catch(() => {});
        return { postId: post.id, result: 'rescheduled', message };
      }
      if (e instanceof PublishRejectedError) return await fail('error', e.message, 'Publication refusée');
      if (e instanceof OutcomeUnknownError) return await fail('unknown', e.message, 'Vérifiez votre publication');
      return await fail('unknown', `Erreur inattendue : ${(e as Error).message}. Vérifiez sur le réseau avant de republier.`, 'Vérifiez votre publication');
    }

    const first = results[0];
    if (!first) return await fail('unknown', 'Le réseau n’a renvoyé aucun résultat. Vérifiez avant de republier.', 'Vérifiez votre publication');
    await db.markPublished(post.id, first);
    return { postId: post.id, result: 'published' };
  } catch (e) {
    // Erreur d'infrastructure (base de données...) : on ne sait pas si le réseau a publié → « unknown », jamais de rejeu.
    const message = `Erreur interne : ${(e as Error).message}. Vérifiez sur le réseau avant de republier.`;
    await db.markPostFailed(post.id, 'unknown', message).catch(() => {});
    return { postId: post.id, result: 'unknown', message };
  }
}
