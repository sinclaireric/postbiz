import type { AgentMessage, AgentProposal, AgentProposalStatus, AgentThread } from '@/lib/agent/types';
import type { FormError } from '@/lib/form-error';
import type { MediaKind } from '@/lib/media/rules';
import type { NetworkId } from '@/lib/inbox/types';
import type { InboxRepository } from '@/lib/inbox/types';

export type OrgRole = 'admin' | 'member' | 'viewer';

export interface AppContext {
  mode: 'demo' | 'supabase';
  user: { id: string; email: string; name: string };
  org: { id: string; name: string; role: OrgRole };
}

export type PostState = 'draft' | 'queued' | 'publishing' | 'published' | 'error' | 'unknown';

/**
 * Où en est le premier commentaire : `pending` attend la publication, `posting` est en cours d'envoi par le worker, `posted` est publié,
 * `failed` a été refusé par le réseau (rien n'est parti : on peut réessayer), `unknown` a une issue incertaine (à vérifier sur le réseau).
 */
export type FirstCommentState = 'pending' | 'posting' | 'posted' | 'failed' | 'unknown';

/** Média joint à une publication, tel que l'affichent le calendrier et la fiche du post. */
export interface PostMedia {
  id: string;
  kind: MediaKind;
  name: string;
  alt: string;
  /** Vignette (ou le fichier lui-même pour une image sans vignette) ; null si le média a été supprimé de la bibliothèque. */
  thumbUrl: string | null;
  /** L'image elle-même (aperçu net dans la fiche du post) ; null pour une vidéo. */
  url: string | null;
  durationSeconds: number | null;
}

export interface PostItem {
  id: string;
  groupId: string;
  /** Canal de la publication (filtre du calendrier) ; vide si le canal n'existe plus. */
  integrationId: string;
  networkId: NetworkId;
  accountName: string;
  content: string;
  publishAt: string | null;
  state: PostState;
  error: string | null;
  releaseUrl: string | null;
  /** Commentaire publié sous la publication, juste après elle (Facebook, LinkedIn, X). */
  firstComment: string | null;
  firstCommentState: FirstCommentState | null;
  firstCommentError: string | null;
  media: PostMedia[];
}

export interface IntegrationItem {
  id: string;
  networkId: NetworkId;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  status: 'active' | 'refresh_needed' | 'disabled';
}

export interface MemberItem {
  userId: string;
  name: string;
  role: OrgRole;
}

export interface CreatePostInput {
  /** Un canal par entrée ; le premier commentaire n'est donné qu'aux canaux qui savent le publier. */
  targets: { integrationId: string; firstComment: string | null }[];
  content: string;
  /** Médias joints, dans l'ordre d'affichage ; les mêmes pour tous les canaux. */
  media: { id: string; kind: MediaKind; alt: string }[];
  publishAt: string | null; // ISO UTC
  mode: 'draft' | 'schedule';
}

export interface Result {
  ok: boolean;
  error?: FormError;
}

export interface PostsRepository {
  list(): Promise<PostItem[]>;
  create(input: CreatePostInput): Promise<Result>;
  remove(groupId: string): Promise<Result>;
  /** Remet en file un premier commentaire refusé par le réseau (état `failed`) ; le worker le republie. */
  retryFirstComment(postId: string): Promise<Result>;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
  read: boolean;
  /** Page de l'application à ouvrir au clic. */
  href: string | null;
}

export interface WorkspaceRepository {
  integrations(): Promise<IntegrationItem[]>;
  members(): Promise<MemberItem[]>;
  renameOrganization(name: string): Promise<Result>;
  notifications(): Promise<NotificationItem[]>;
  markNotificationsRead(): Promise<Result>;
}

export interface MediaItem {
  id: string;
  path: string;
  /** Nom d'origine du fichier (affichage et recherche). */
  name: string;
  mimeType: string | null;
  kind: MediaKind;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Texte alternatif par défaut, repris quand le média est joint à une publication. */
  alt: string;
  createdAt: string;
  /** URL signée temporaire du fichier (null si indisponible). */
  url: string | null;
  /** URL signée temporaire d'une vignette légère (grille de la bibliothèque), null si le média n'en a pas. */
  thumbUrl: string | null;
}

export interface MediaPage {
  items: MediaItem[];
  total: number;
}

export interface MediaRemoval {
  removed: string[];
  /** Médias gardés parce que des publications en attente les utilisent. */
  blocked: { id: string; posts: number }[];
}

export interface MediaRepository {
  list(o?: { page?: number; pageSize?: number; search?: string }): Promise<MediaPage>;
  /** Médias demandés, dans l'ordre des identifiants ; ceux qui n'existent pas (ou plus) sont ignorés. */
  byIds(ids: string[]): Promise<MediaItem[]>;
  /** Supprime les médias qu'aucune publication en attente n'utilise ; les autres sont renvoyés dans `blocked`. */
  remove(ids: string[]): Promise<MediaRemoval>;
}

/** Limites d'une fiche : les mêmes que dans la base (migration knowledge). */
export const KNOWLEDGE_LIMITS = { title: 120, content: 20_000, items: 100 } as const;

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface KnowledgeInput {
  title: string;
  content: string;
}

/** Fiches que l'assistant IA lit pour écrire dans la voix de l'organisation (ton, offres, produits, questions fréquentes). */
export interface KnowledgeRepository {
  list(): Promise<KnowledgeItem[]>;
  create(input: KnowledgeInput): Promise<Result>;
  update(id: string, input: KnowledgeInput): Promise<Result>;
  remove(id: string): Promise<Result>;
}

/** Ce que l'utilisateur a fait d'une publication préparée par l'agent : son état, et le texte, les médias et la date tels qu'il les a enregistrés. */
export interface AgentProposalUpdate {
  id: string;
  status: AgentProposalStatus;
  text: string;
  firstComment: string | null;
  mediaIds: string[];
  publishAt: string | null;
}

export interface AgentExchangeInput {
  /** Conversation existante, ou null pour en ouvrir une (son titre vient de `title`). */
  threadId: string | null;
  title: string;
  user: { text: string; mediaIds: string[] };
  assistant: { text: string; proposals: AgentProposal[] };
}

export interface AgentExchange {
  thread: AgentThread;
  user: AgentMessage;
  assistant: AgentMessage;
}

/** Conversations de l'agent : chacune est privée à son auteur (RLS). */
export interface AgentRepository {
  /** Les conversations de l'utilisateur, la plus récente d'abord. */
  threads(): Promise<AgentThread[]>;
  thread(id: string): Promise<{ thread: AgentThread; messages: AgentMessage[] } | null>;
  /** Enregistre un échange (le message de l'utilisateur, puis la réponse de l'agent) ; ouvre la conversation si besoin. Null si rien n'a pu être écrit. */
  saveExchange(input: AgentExchangeInput): Promise<AgentExchange | null>;
  /** Met à jour l'état des publications d'un message de l'agent (après leur enregistrement dans le calendrier). */
  updateProposals(messageId: string, updates: AgentProposalUpdate[]): Promise<Result>;
  removeThread(id: string): Promise<Result>;
}

export interface Repositories {
  agent: AgentRepository;
  media: MediaRepository;
  knowledge: KnowledgeRepository;
  inbox: InboxRepository;
  posts: PostsRepository;
  workspace: WorkspaceRepository;
}


