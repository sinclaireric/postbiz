import type { FormError } from '@/lib/form-error';
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

export interface PostItem {
  id: string;
  groupId: string;
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
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  /** URL signée temporaire d'affichage (null en mode démo). */
  url: string | null;
}

export interface MediaRepository {
  list(): Promise<MediaItem[]>;
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

export interface Repositories {
  media: MediaRepository;
  knowledge: KnowledgeRepository;
  inbox: InboxRepository;
  posts: PostsRepository;
  workspace: WorkspaceRepository;
}


