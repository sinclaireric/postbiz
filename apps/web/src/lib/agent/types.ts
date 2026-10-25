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
  /** Génération : chaque image ou vidéo est facturée par le fournisseur, donc plafonnée par message (et par jour, voir `config.ts`). */
  imagesPerMessage: 3,
  videosPerMessage: 1,
  generationPrompt: 2_000,
  /** Images de la médiathèque que l'on peut donner à Seedance comme référence (comme dans Postiz). */
  videoReferences: 3,
  /** Recherches dans la base de connaissance pour une même demande. */
  knowledgeSearches: 3,
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
  /** Message de l'utilisateur : médias de la bibliothèque joints. Message de l'agent : images qu'il a générées. */
  mediaIds: string[];
  /** Vidéos que l'agent a lancées dans ce message (leur état se lit dans `ai_video_jobs`, il change après coup). */
  jobIds: string[];
  createdAt: string;
}

/** `pending` : en cours chez le fournisseur ; `completed` : enregistrée dans la médiathèque ; `failed` : abandonnée (`error` en donne la raison). */
export type AgentJobStatus = 'pending' | 'completed' | 'failed';
export type VideoOrientation = 'vertical' | 'horizontal';

/** Une vidéo en cours de génération (Seedance) : elle prend plusieurs minutes, bien plus qu'une réponse de l'agent. */
export interface AgentVideoJob {
  id: string;
  status: AgentJobStatus;
  orientation: VideoOrientation;
  prompt: string;
  /** La vidéo, une fois terminée. */
  mediaId: string | null;
  /** Raison de l'échec, déjà lisible (jamais une réponse brute du fournisseur). */
  error: string | null;
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

/** Ce que renvoie `GET /api/agent/video/<id>` : l'état de la vidéo, et, une fois prête, son média et une adresse signée pour la lire. */
export interface VideoJobResponse {
  job: AgentVideoJob;
  media: AgentMedia | null;
  /** Adresse signée et temporaire de la vidéo (le bucket est privé). */
  url: string | null;
}

export type AgentErrorCode = 'disabled' | 'forbidden' | 'invalid' | 'rate_limited' | 'refused' | 'empty' | 'failed' | 'not_found';

/** Ce que la route d'API renvoie au navigateur, un objet JSON par ligne. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  /** L'agent consulte quelque chose (publications, médias) ou prépare des publications : le navigateur affiche « … en cours ». */
  | { type: 'tool'; name: AgentToolName }
  | { type: 'proposals'; proposals: AgentProposal[]; media: AgentMedia[] }
  /** Images que l'agent vient de générer : déjà dans la médiathèque. */
  | { type: 'media'; media: AgentMedia[] }
  /** Une vidéo vient d'être lancée (ou son état a changé) : le navigateur suit sa progression. */
  | { type: 'job'; job: AgentVideoJob }
  | { type: 'done'; thread: AgentThread; user: AgentMessage; assistant: AgentMessage }
  | { type: 'error'; code: AgentErrorCode };

export const AGENT_TOOLS = ['list_posts', 'list_media', 'propose_posts', 'generate_image', 'generate_video', 'video_status', 'search_knowledge'] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

/** Corps de la requête envoyée à la route d'API (donnée non fiable : relue par `parseChatRequest`). */
export interface AgentChatRequest {
  threadId: string | null;
  message: string;
  channelIds: string[];
  mediaIds: string[];
  timeZone: string;
}
