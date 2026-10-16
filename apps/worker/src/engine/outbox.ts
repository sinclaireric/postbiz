import {
  MetaOutcomeUnknownError, MetaRejectedError, replyToComment, sendDirectMessage, type FetchLike,
} from '@postbiz/core';
import type { WorkerDb, WorkerMessage } from './db.ts';

const DAY = 86_400_000;

export interface MessageOutcome {
  messageId: string;
  result: 'sent' | 'failed';
  message?: string;
}

type SendFn = typeof sendDirectMessage;
type ReplyFn = typeof replyToComment;

/**
 * Envoie une réponse « réclamée » (delivery_status = sending). Même règle que pour les publications :
 * en cas d'issue incertaine on marque « failed » avec un message explicite, sans jamais renvoyer tout seul.
 */
export async function processMessage(
  deps: { db: WorkerDb; fetch?: FetchLike; now?: () => Date; send?: SendFn; reply?: ReplyFn },
  msg: WorkerMessage
): Promise<MessageOutcome> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const send = deps.send ?? sendDirectMessage;
  const reply = deps.reply ?? replyToComment;

  const fail = async (message: string, reconnectIntegrationId?: string): Promise<MessageOutcome> => {
    if (reconnectIntegrationId) await db.markIntegrationRefreshNeeded(reconnectIntegrationId).catch(() => {});
    await db.failMessage(msg.id, message);
    await db.notify({ userId: msg.sentBy, orgId: msg.orgId, type: 'message_failed', title: 'Réponse non envoyée', body: message, data: { conversationId: msg.conversationId } }).catch(() => {});
    return { messageId: msg.id, result: 'failed', message };
  };

  try {
    const body = (msg.body ?? '').trim();
    if (!body) return await fail('Le message est vide.');

    const conv = await db.getConversation(msg.conversationId);
    if (!conv) return await fail('Conversation introuvable.');
    const integration = await db.getIntegration(conv.integrationId);
    if (!integration) return await fail('Le canal n’existe plus.');
    if (integration.provider !== 'facebook' && integration.provider !== 'instagram') {
      return await fail('L’envoi de réponses n’est pas encore disponible pour ce réseau.');
    }
    if (integration.status !== 'active') return await fail(`Le canal « ${integration.name} » doit être reconnecté.`);

    const accessToken = await db.getAccessToken(integration.id);
    if (!accessToken) return await fail(`Aucun accès valide pour « ${integration.name} » : reconnectez le canal.`, integration.id);

    const client = {
      accessToken,
      fetch: deps.fetch,
      host: (integration.settings.graph_host as string | undefined) ?? 'graph.facebook.com',
    };

    let externalId: string;
    if (conv.kind === 'comment_thread') {
      externalId = (await reply(client, integration.provider, conv.externalId, body)).commentId;
    } else {
      const expires = conv.replyWindowExpiresAt ? new Date(conv.replyWindowExpiresAt).getTime() : 0;
      let humanAgent = false;
      if (expires <= now.getTime()) {
        // Fenêtre standard de 24 h dépassée : seul le tag HUMAN_AGENT (7 jours, soumis à l'approbation de Meta) permet de répondre.
        const lastInbound = conv.lastInboundAt ? new Date(conv.lastInboundAt).getTime() : 0;
        const allowed = integration.settings.human_agent_enabled === true && now.getTime() - lastInbound <= 7 * DAY;
        if (!allowed) return await fail('La fenêtre de 24 h est dépassée : Meta n’autorise plus de réponse à cette conversation.');
        humanAgent = true;
      }
      externalId = (
        await send(client, {
          senderId: (integration.settings.messaging_sender_id as string | undefined) ?? integration.internalId,
          recipientId: conv.contactPlatformId,
          text: body,
          humanAgent,
        })
      ).messageId;
    }

    await db.completeMessage(msg.id, externalId);
    return { messageId: msg.id, result: 'sent' };
  } catch (e) {
    if (e instanceof MetaRejectedError) {
      const integrationId = e.needsReconnect ? (await db.getConversation(msg.conversationId))?.integrationId : undefined;
      return await fail(e.needsReconnect ? 'L’accès au compte a expiré : reconnectez le canal.' : `Meta a refusé l’envoi : ${e.message}`, integrationId);
    }
    if (e instanceof MetaOutcomeUnknownError) {
      return await fail(`Résultat inconnu : ${e.message}. Vérifiez sur le réseau avant de renvoyer.`);
    }
    return await fail(`Erreur inattendue : ${(e as Error).message}. Vérifiez sur le réseau avant de renvoyer.`);
  }
}
