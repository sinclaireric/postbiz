import type { NetworkId } from '@/lib/inbox/types';
import type { InboxRepository } from '@/lib/inbox/types';

export type OrgRole = 'admin' | 'member' | 'viewer';

export interface AppContext {
  mode: 'demo' | 'supabase';
  user: { id: string; email: string; name: string };
  org: { id: string; name: string; role: OrgRole };
}

export type PostState = 'draft' | 'queued' | 'publishing' | 'published' | 'error' | 'unknown';

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
  integrationIds: string[];
  content: string;
  publishAt: string | null; // ISO UTC
  mode: 'draft' | 'schedule';
}

export interface Result {
  ok: boolean;
  error?: string;
}

export interface PostsRepository {
  list(): Promise<PostItem[]>;
  create(input: CreatePostInput): Promise<Result>;
  remove(groupId: string): Promise<Result>;
}

export interface WorkspaceRepository {
  integrations(): Promise<IntegrationItem[]>;
  members(): Promise<MemberItem[]>;
  renameOrganization(name: string): Promise<Result>;
}

export interface Repositories {
  inbox: InboxRepository;
  posts: PostsRepository;
  workspace: WorkspaceRepository;
}

export const ROLE_LABEL: Record<OrgRole, string> = { admin: 'Administrateur', member: 'Membre', viewer: 'Lecteur' };
