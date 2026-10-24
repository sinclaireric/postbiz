import type { NetworkId } from '@/lib/inbox/types';
import type { MediaKind } from '@/lib/media/rules';

/**
 * Bornes de l'agent. L'agent est facturé à l'usage : chaque limite plafonne ce qu'une conversation peut coûter.
 * `message` et `mediaPerMessage` bornent ce que le navigateur envoie ; `historyMessages` et `historyChars` ce que le modèle relit à chaque tour ;
 * `toolTurns` le nombre d'appels au modèle pour une seule demande ; `proposalsPerCall` le nombre de publications préparées d'un coup.
 */
export const AGENT_LIMITS = {
  message: 2_000,
  mediaPerMessage: 6,
  channels: 12,
  historyMessages: 14,
  historyChars: 20_000,
  toolTurns: 4,
  proposalsPerCall: 8,
  threadTitle: 80,
} as const;

/** `pending` : à relire ; `draft` : enregistrée en brouillon ; `scheduled` : programmée. */
export type AgentProposalStatus = 'pending' | 'draft' | 'scheduled';

/** Une publication préparée par l'agent pour un canal. Rien n'est écrit dans le calendrier tant que l'utilisateur ne l'a pas validée. */
export interface AgentProposal {
  id: string;
  integrationId: string;
  networkId: NetworkId;
  accountName: string;
  text: string;
  firstComment: string | null;
  mediaIds: string[];
  /** Date de publication proposée (ISO, UTC) ; vide : le navigateur propose le prochain créneau. */
  publishAt: string | null;
  status: AgentProposalStatus;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposals: AgentProposal[];
  /** Médias de la bibliothèque joints au message de l'utilisateur. */
  mediaIds: string[];
  createdAt: string;
}

export interface AgentThread {
  id: string;
  title: string;
  updatedAt: string;
}

/** Un média de la bibliothèque tel que l'affichent les aperçus : mêmes champs que `PreviewMedia`. */
export interface AgentMedia {
  id: string;
  kind: MediaKind;
  name: string;
  alt: string;
  url: string | null;
  thumbUrl: string | null;
  durationSeconds: number | null;
}

export type AgentErrorCode = 'disabled' | 'forbidden' | 'invalid' | 'rate_limited' | 'refused' | 'empty' | 'failed' | 'not_found';

/** Ce que la route d'API renvoie au navigateur, un objet JSON par ligne. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  /** L'agent consulte quelque chose (publications, médias) ou prépare des publications : le navigateur affiche « … en cours ». */
  | { type: 'tool'; name: AgentToolName }
  | { type: 'proposals'; proposals: AgentProposal[]; media: AgentMedia[] }
  | { type: 'done'; thread: AgentThread; user: AgentMessage; assistant: AgentMessage }
  | { type: 'error'; code: AgentErrorCode };

export const AGENT_TOOLS = ['list_posts', 'list_media', 'propose_posts'] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

/** Corps de la requête envoyée à la route d'API (donnée non fiable : relue par `parseChatRequest`). */
export interface AgentChatRequest {
  threadId: string | null;
  message: string;
  channelIds: string[];
  mediaIds: string[];
  timeZone: string;
}
