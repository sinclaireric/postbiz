import { OutcomeUnknownError, PublishRejectedError, ReconnectRequiredError } from '../providers/errors.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { WorkerDb, WorkerPost } from './db.ts';

export interface CommentOutcome {
  postId: string;
  result: 'posted' | 'failed' | 'unknown';
  message?: string;
}

/**
 * Publie le premier commentaire d'un post déjà publié et « réclamé » (first_comment_state = `posting`, verrou posé par
 * claim_first_comments). Même règle que pour les publications : on ne rejoue JAMAIS un envoi dont l'issue est incertaine.
 *  - refus clair du réseau   → `failed`  (rien n'est parti ; l'utilisateur peut réessayer depuis le calendrier)
 *  - issue inconnue / erreur → `unknown` (l'utilisateur vérifie sous la publication avant de recommenter)
 * La publication elle-même reste « published » dans tous les cas.
 */
export async function processFirstComment(deps: { db: WorkerDb; providers: ProviderRegistry }, post: WorkerPost): Promise<CommentOutcome> {
  const { db, providers } = deps;

  const fail = async (state: 'failed' | 'unknown', message: string, title: string): Promise<CommentOutcome> => {
    await db.failFirstComment(post.id, state, message);
    await db.notify({ userId: post.createdBy, orgId: post.orgId, type: `comment_${state}`, title, body: message, data: { postId: post.id } }).catch(() => {});
    return { postId: post.id, result: state, message };
  };

  try {
    const text = (post.firstComment ?? '').trim();
    if (!text) return await fail('failed', 'Le premier commentaire est vide.', 'Premier commentaire non publié');
    if (!post.releaseId) return await fail('failed', 'La publication n’a pas d’identifiant chez le réseau : impossible de commenter dessous.', 'Premier commentaire non publié');

    const integration = await db.getIntegration(post.integrationId);
    if (!integration) return await fail('failed', 'Le canal n’existe plus.', 'Premier commentaire non publié');
    if (integration.status !== 'active') return await fail('failed', `Le canal « ${integration.name} » doit être reconnecté.`, 'Canal à reconnecter');

    const provider = providers(integration.provider);
    if (!provider?.comment) return await fail('failed', `Le premier commentaire n’est pas encore disponible sur ${integration.provider}.`, 'Premier commentaire non publié');

    const accessToken = await db.getAccessToken(integration.id);
    if (!accessToken) {
      await db.markIntegrationRefreshNeeded(integration.id);
      return await fail('failed', `Aucun accès valide pour « ${integration.name} » : reconnectez le canal.`, 'Canal à reconnecter');
    }

    let commentId: string;
    try {
      ({ commentId } = await provider.comment({
        accessToken,
        integration: { id: integration.id, internalId: integration.internalId, settings: integration.settings },
        releaseId: post.releaseId,
        text,
      }));
    } catch (e) {
      if (e instanceof ReconnectRequiredError) {
        await db.markIntegrationRefreshNeeded(integration.id);
        return await fail('failed', e.message, 'Canal à reconnecter');
      }
      if (e instanceof PublishRejectedError) return await fail('failed', e.message, 'Premier commentaire refusé');
      if (e instanceof OutcomeUnknownError) return await fail('unknown', e.message, 'Vérifiez votre premier commentaire');
      return await fail('unknown', `Erreur inattendue : ${(e as Error).message}. Vérifiez sous la publication avant de recommenter.`, 'Vérifiez votre premier commentaire');
    }

    await db.completeFirstComment(post.id, commentId);
    return { postId: post.id, result: 'posted' };
  } catch (e) {
    // Erreur d'infrastructure (base de données…) : on ne sait pas si le réseau a publié → « unknown », jamais de rejeu.
    const message = `Erreur interne : ${(e as Error).message}. Vérifiez sous la publication avant de recommenter.`;
    await db.failFirstComment(post.id, 'unknown', message).catch(() => {});
    return { postId: post.id, result: 'unknown', message };
  }
}
