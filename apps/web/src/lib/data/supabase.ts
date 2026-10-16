import type { SupabaseClient } from '@supabase/supabase-js';
import { GENERIC_ERROR, type FormError } from '@/lib/form-error';
import { replyWindow, validateReply } from '@/lib/inbox/logic';
import type {
  ConversationDetail, ConversationStatus, ConversationSummary, InboxRepository, MessageItem, NetworkId, NoteItem,
} from '@/lib/inbox/types';
import type {
  AppContext, CreatePostInput, IntegrationItem, MediaItem, MemberItem, NotificationItem, OrgRole, PostItem, PostsRepository, Repositories, Result, WorkspaceRepository,
} from './types';

// Implémentation Supabase. Toutes les requêtes passent par la clé « anon » + la session de l'utilisateur :
// c'est la RLS de la base (supabase/migrations) qui garantit l'isolation entre organisations.
// ⚠️ Non testé contre un projet Supabase réel dans cette version : à valider avec un projet de développement.

type Row = Record<string, any>;

/** PostgREST renvoie un objet (ou un tableau selon la relation) pour une table jointe. */
const one = <T extends Row>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const fail = (error: FormError): Result => ({ ok: false, error });

async function profileNames(supabase: SupabaseClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', unique);
  return new Map((data ?? []).map((p: Row) => [p.id as string, (p.display_name as string | null) ?? 'Membre']));
}

function toSummary(r: Row, names: Map<string, string>): ConversationSummary {
  const integ = one<Row>(r.integrations);
  const contact = one<Row>(r.contacts);
  return {
    id: r.id,
    networkId: (integ?.provider ?? 'facebook') as NetworkId,
    accountName: integ?.name ?? '',
    kind: r.kind,
    contactName: contact?.name ?? contact?.username ?? '',
    contactUsername: contact?.username ?? null,
    status: r.status,
    assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? 'Membre') : null,
    unreadCount: r.unread_count ?? 0,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview ?? '',
    replyWindowExpiresAt: r.reply_window_expires_at ?? null,
  };
}

const CONVERSATION_COLUMNS =
  'id, kind, status, unread_count, last_message_at, last_message_preview, reply_window_expires_at, assignee_id, integrations(provider, name), contacts(name, username)';

export function createSupabaseRepositories(supabase: SupabaseClient, ctx: AppContext): Repositories {
  const inbox: InboxRepository = {
    async listConversations() {
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_COLUMNS)
        .eq('org_id', ctx.org.id)
        .order('last_message_at', { ascending: false })
        .limit(200);
      if (error || !data) return [];
      const names = await profileNames(supabase, data.map((r: Row) => r.assignee_id));
      return data.map((r: Row) => toSummary(r, names));
    },

    async getConversation(id) {
      const { data: c } = await supabase.from('conversations').select(CONVERSATION_COLUMNS).eq('id', id).eq('org_id', ctx.org.id).maybeSingle();
      if (!c) return null;
      const [{ data: msgs }, { data: notes }] = await Promise.all([
        supabase.from('messages').select('id, direction, body, attachments, sent_by, delivery_status, error, created_at').eq('conversation_id', id).order('created_at', { ascending: true }),
        supabase.from('conversation_notes').select('id, author_id, body, created_at').eq('conversation_id', id).order('created_at', { ascending: true }),
      ]);
      const names = await profileNames(supabase, [c.assignee_id, ...(msgs ?? []).map((m: Row) => m.sent_by), ...(notes ?? []).map((n: Row) => n.author_id)]);
      const messages: MessageItem[] = (msgs ?? []).map((m: Row) => ({
        id: m.id, direction: m.direction, body: m.body, attachments: m.attachments ?? [],
        sentByName: m.sent_by ? (names.get(m.sent_by) ?? 'Membre') : null,
        deliveryStatus: m.delivery_status, error: m.error ?? null, createdAt: m.created_at,
      }));
      const noteItems: NoteItem[] = (notes ?? []).map((n: Row) => ({
        id: n.id, authorName: names.get(n.author_id) ?? 'Membre', body: n.body, createdAt: n.created_at,
      }));
      return { ...toSummary(c, names), messages, notes: noteItems } satisfies ConversationDetail;
    },

    async sendReply(conversationId, body) {
      const { data: c } = await supabase.from('conversations').select('reply_window_expires_at').eq('id', conversationId).eq('org_id', ctx.org.id).maybeSingle();
      if (!c) return fail({ key: 'app.inbox.notFound' });
      const invalid = validateReply(body, replyWindow(c.reply_window_expires_at));
      if (invalid) return fail(invalid);
      // Le message est mis en file (« queued ») : le worker l'envoie au réseau puis le passe à « sent » ou « failed ».
      const { error } = await supabase.from('messages').insert({
        org_id: ctx.org.id, conversation_id: conversationId, direction: 'out', body: body.trim(),
        sent_by: ctx.user.id, delivery_status: 'queued',
      });
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async setStatus(conversationId, status: ConversationStatus) {
      const { error } = await supabase.from('conversations').update({ status }).eq('id', conversationId).eq('org_id', ctx.org.id);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async markRead(conversationId) {
      const { error } = await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId).eq('org_id', ctx.org.id);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async addNote(conversationId, body) {
      const { error } = await supabase.from('conversation_notes').insert({
        org_id: ctx.org.id, conversation_id: conversationId, author_id: ctx.user.id, body: body.trim(),
      });
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },
  };

  const posts: PostsRepository = {
    async list() {
      const { data, error } = await supabase
        .from('posts')
        .select('id, group_id, content, publish_at, state, error, release_url, integrations(provider, name)')
        .eq('org_id', ctx.org.id)
        .is('deleted_at', null)
        .is('parent_post_id', null)
        .order('publish_at', { ascending: true, nullsFirst: false })
        .limit(300);
      if (error || !data) return [];
      return data.map((p: Row): PostItem => {
        const integ = one<Row>(p.integrations);
        return {
          id: p.id, groupId: p.group_id, networkId: (integ?.provider ?? 'facebook') as NetworkId, accountName: integ?.name ?? '',
          content: p.content, publishAt: p.publish_at, state: p.state, error: p.error ?? null, releaseUrl: p.release_url ?? null,
        };
      });
    },

    async create(input: CreatePostInput) {
      const groupId = crypto.randomUUID();
      const rows = input.integrationIds.map((integration_id) => ({
        org_id: ctx.org.id, integration_id, group_id: groupId, content: input.content.trim(),
        publish_at: input.publishAt, state: input.mode === 'schedule' ? 'queued' : 'draft', created_by: ctx.user.id,
      }));
      const { error } = await supabase.from('posts').insert(rows);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async remove(groupId) {
      const { error } = await supabase
        .from('posts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('group_id', groupId)
        .eq('org_id', ctx.org.id)
        .in('state', ['draft', 'queued', 'error', 'unknown']);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },
  };

  const workspace: WorkspaceRepository = {
    async integrations() {
      const { data } = await supabase
        .from('integrations')
        .select('id, provider, name, username, picture_url, status')
        .eq('org_id', ctx.org.id)
        .order('created_at', { ascending: true });
      return (data ?? []).map((i: Row): IntegrationItem => ({
        id: i.id, networkId: i.provider, name: i.name, username: i.username ?? null, pictureUrl: i.picture_url ?? null, status: i.status,
      }));
    },

    async members() {
      const { data } = await supabase.from('memberships').select('user_id, role').eq('org_id', ctx.org.id).order('created_at', { ascending: true });
      const names = await profileNames(supabase, (data ?? []).map((m: Row) => m.user_id));
      return (data ?? []).map((m: Row): MemberItem => ({ userId: m.user_id, name: names.get(m.user_id) ?? 'Membre', role: m.role as OrgRole }));
    },

    async notifications() {
      const { data } = await supabase
        .from('notifications')
        .select('id, type, title, body, data, read_at, created_at')
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []).map((n: Row): NotificationItem => ({
        id: n.id, type: n.type, title: n.title, body: n.body ?? null, createdAt: n.created_at, read: !!n.read_at,
        href: n.data?.conversationId ? `/app/inbox?c=${encodeURIComponent(String(n.data.conversationId))}` : n.data?.postId ? '/app/calendrier' : null,
      }));
    },

    async markNotificationsRead() {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.user.id).is('read_at', null);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async renameOrganization(name) {
      const { error } = await supabase.from('organizations').update({ name: name.trim() }).eq('id', ctx.org.id);
      return error ? fail({ key: 'app.settings.errRename' }) : { ok: true };
    },
  };

  const media = {
    async list(): Promise<MediaItem[]> {
      const { data } = await supabase
        .from('media')
        .select('id, path, mime_type, size_bytes, created_at')
        .eq('org_id', ctx.org.id)
        .order('created_at', { ascending: false })
        .limit(200);
      const rows = (data ?? []) as Row[];
      const signed = rows.length ? await supabase.storage.from('media').createSignedUrls(rows.map((r) => r.path as string), 3600) : { data: [] as Row[] };
      const urlByPath = new Map<string, string>((signed.data ?? []).filter((x: Row) => x.signedUrl).map((x: Row) => [x.path as string, x.signedUrl as string]));
      return rows.map((r) => ({ id: r.id, path: r.path, mimeType: r.mime_type ?? null, sizeBytes: r.size_bytes ?? null, createdAt: r.created_at, url: urlByPath.get(r.path) ?? null }));
    },
  };

  return { inbox, posts, workspace, media };
}
