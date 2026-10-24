import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeProposals } from '@/lib/agent/proposal';
import type { AgentMessage, AgentThread } from '@/lib/agent/types';
import { createSupabaseAnalytics } from '@/lib/analytics/supabase';
import { GENERIC_ERROR, type FormError } from '@/lib/form-error';
import { replyWindow, validateReply } from '@/lib/inbox/logic';
import { displayName } from '@/lib/media/logic';
import type {
  ConversationDetail, ConversationStatus, ConversationSummary, InboxRepository, MessageItem, NetworkId, NoteItem,
} from '@/lib/inbox/types';
import { KNOWLEDGE_LIMITS } from './types';
import type {
  AgentRepository, AppContext, CreatePostInput, IntegrationItem, KnowledgeInput, KnowledgeItem, KnowledgeRepository, MediaItem, MediaRepository, MemberItem, NotificationItem, OrgRole, PostItem, PostMedia, PostsRepository, Repositories, Result, WorkspaceRepository,
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

  // ---------------------------------------------------------------- médias
  const MEDIA_COLUMNS = 'id, path, name, mime_type, kind, size_bytes, width, height, duration_seconds, alt, thumbnail_path, created_at';
  const MEDIA_URL_TTL = 3600;

  /** URL signées temporaires (le bucket est privé). Les chemins sans URL (fichier absent) manquent simplement du résultat. */
  async function signPaths(paths: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(paths.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const { data } = await supabase.storage.from('media').createSignedUrls(unique, MEDIA_URL_TTL);
    return new Map((data ?? []).filter((x: Row) => x.signedUrl).map((x: Row) => [x.path as string, x.signedUrl as string]));
  }

  async function toMediaItems(rows: Row[]): Promise<MediaItem[]> {
    const urls = await signPaths(rows.flatMap((r) => [r.path as string, r.thumbnail_path as string]));
    return rows.map((r): MediaItem => ({
      id: r.id, path: r.path, name: r.name ?? displayName(r.path), mimeType: r.mime_type ?? null, kind: r.kind === 'video' ? 'video' : 'image',
      sizeBytes: r.size_bytes ?? null, width: r.width ?? null, height: r.height ?? null,
      durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds), alt: r.alt ?? '', createdAt: r.created_at,
      url: urls.get(r.path) ?? null, thumbUrl: r.thumbnail_path ? urls.get(r.thumbnail_path) ?? null : null,
    }));
  }

  const media: MediaRepository = {
    async list({ page = 1, pageSize = 40, search } = {}) {
      const from = (Math.max(1, page) - 1) * pageSize;
      let query = supabase.from('media').select(MEDIA_COLUMNS, { count: 'exact' }).eq('org_id', ctx.org.id);
      const term = search?.trim();
      // Les jokers de LIKE (% et _) saisis par l'utilisateur ne doivent pas être interprétés.
      if (term) query = query.ilike('name', `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const { data, count } = await query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
      return { items: await toMediaItems((data ?? []) as Row[]), total: count ?? 0 };
    },

    async byIds(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];
      const { data } = await supabase.from('media').select(MEDIA_COLUMNS).eq('org_id', ctx.org.id).in('id', unique);
      const items = await toMediaItems((data ?? []) as Row[]);
      const byId = new Map(items.map((m) => [m.id, m]));
      return ids.map((id) => byId.get(id)).filter((m): m is MediaItem => !!m);
    },

    async remove(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return { removed: [], blocked: [] };
      const { data: usage } = await supabase.rpc('media_usage', { p_ids: unique });
      const used = new Map<string, number>(((usage ?? []) as Row[]).map((u) => [u.media_id as string, Number(u.post_count)]));
      const blocked = unique.filter((id) => (used.get(id) ?? 0) > 0).map((id) => ({ id, posts: used.get(id)! }));
      const free = unique.filter((id) => !(used.get(id) ?? 0));
      if (free.length === 0) return { removed: [], blocked };
      const { data: rows } = await supabase.from('media').select('id, path, thumbnail_path, normalized_path').eq('org_id', ctx.org.id).in('id', free);
      const found = (rows ?? []) as Row[];
      if (found.length === 0) return { removed: [], blocked };
      const del = await supabase.from('media').delete().eq('org_id', ctx.org.id).in('id', found.map((r) => r.id));
      if (del.error) return { removed: [], blocked };
      await supabase.storage.from('media').remove(found.flatMap((r) => [r.path, r.thumbnail_path, r.normalized_path].filter(Boolean) as string[]));
      return { removed: found.map((r) => r.id as string), blocked };
    },
  };

  const posts: PostsRepository = {
    async list() {
      const { data, error } = await supabase
        .from('posts')
        .select('id, group_id, integration_id, content, publish_at, state, error, release_url, first_comment, first_comment_state, first_comment_error, media, integrations(provider, name)')
        .eq('org_id', ctx.org.id)
        .is('deleted_at', null)
        .is('parent_post_id', null)
        .order('publish_at', { ascending: true, nullsFirst: false })
        .limit(300);
      if (error || !data) return [];
      // Médias joints : un seul aller-retour pour tout le calendrier. Un média supprimé de la bibliothèque disparaît de l'affichage, pas du post.
      const wanted = [...new Set(data.flatMap((p: Row) => (Array.isArray(p.media) ? p.media : []).map((m: Row) => String(m.media_id))))] as string[];
      const library = new Map((await media.byIds(wanted)).map((m) => [m.id, m]));
      return data.map((p: Row): PostItem => {
        const integ = one<Row>(p.integrations);
        const attached: PostMedia[] = (Array.isArray(p.media) ? p.media : []).flatMap((m: Row): PostMedia[] => {
          const item = library.get(String(m.media_id));
          if (!item) return [];
          return [{ id: item.id, kind: item.kind, name: item.name, alt: typeof m.alt === 'string' ? m.alt : item.alt, thumbUrl: item.thumbUrl ?? (item.kind === 'image' ? item.url : null), url: item.kind === 'image' ? item.url : null, durationSeconds: item.durationSeconds }];
        });
        return {
          id: p.id, groupId: p.group_id, integrationId: p.integration_id ?? '', networkId: (integ?.provider ?? 'facebook') as NetworkId, accountName: integ?.name ?? '',
          content: p.content, publishAt: p.publish_at, state: p.state, error: p.error ?? null, releaseUrl: p.release_url ?? null,
          firstComment: p.first_comment ?? null, firstCommentState: p.first_comment_state ?? null, firstCommentError: p.first_comment_error ?? null,
          media: attached,
        };
      });
    },

    async create(input: CreatePostInput) {
      const groupId = crypto.randomUUID();
      const rows = input.targets.map((target) => ({
        org_id: ctx.org.id, integration_id: target.integrationId, group_id: groupId, content: input.content.trim(),
        publish_at: input.publishAt, state: input.mode === 'schedule' ? 'queued' : 'draft', created_by: ctx.user.id,
        first_comment: target.firstComment,
        media: input.media.map((m) => ({ media_id: m.id, type: m.kind, ...(m.alt.trim() ? { alt: m.alt.trim().slice(0, 1500) } : {}) })),
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

    async retryFirstComment(postId) {
      const { data, error } = await supabase.rpc('retry_first_comment', { p_post_id: postId });
      return error || data !== true ? fail(GENERIC_ERROR) : { ok: true };
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

  const knowledge: KnowledgeRepository = {
    async list() {
      const { data } = await supabase
        .from('knowledge_items')
        .select('id, title, content, updated_at')
        .eq('org_id', ctx.org.id)
        .order('updated_at', { ascending: false })
        .limit(KNOWLEDGE_LIMITS.items);
      return (data ?? []).map((k: Row): KnowledgeItem => ({ id: k.id, title: k.title, content: k.content, updatedAt: k.updated_at }));
    },

    async create(input: KnowledgeInput) {
      const { error } = await supabase.from('knowledge_items').insert({
        org_id: ctx.org.id, title: input.title.trim(), content: input.content.trim(), created_by: ctx.user.id,
      });
      if (error?.message?.includes('knowledge_items_limit')) return fail({ key: 'app.knowledge.errLimit', params: { max: KNOWLEDGE_LIMITS.items } });
      return error ? fail({ key: 'app.knowledge.errSave' }) : { ok: true };
    },

    async update(id, input) {
      const { data, error } = await supabase
        .from('knowledge_items')
        .update({ title: input.title.trim(), content: input.content.trim() })
        .eq('id', id)
        .eq('org_id', ctx.org.id)
        .select('id');
      return error || !data?.length ? fail({ key: 'app.knowledge.errSave' }) : { ok: true };
    },

    async remove(id) {
      const { error } = await supabase.from('knowledge_items').delete().eq('id', id).eq('org_id', ctx.org.id);
      return error ? fail({ key: 'app.knowledge.errSave' }) : { ok: true };
    },
  };

  const toThread = (r: Row): AgentThread => ({ id: r.id, title: r.title, updatedAt: r.updated_at });
  const toAgentMessage = (r: Row): AgentMessage => ({
    id: r.id, role: r.role === 'assistant' ? 'assistant' : 'user', text: r.content ?? '', proposals: sanitizeProposals(r.proposals),
    mediaIds: Array.isArray(r.media_ids) ? r.media_ids.filter((m: unknown): m is string => typeof m === 'string') : [], createdAt: r.created_at,
  });
  const MESSAGE_COLUMNS = 'id, role, content, proposals, media_ids, created_at';

  const agent: AgentRepository = {
    async threads() {
      const { data } = await supabase.from('agent_threads').select('id, title, updated_at').eq('org_id', ctx.org.id).eq('user_id', ctx.user.id).order('updated_at', { ascending: false }).limit(200);
      return (data ?? []).map(toThread);
    },

    async thread(id) {
      const { data: row } = await supabase.from('agent_threads').select('id, title, updated_at').eq('id', id).eq('org_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle();
      if (!row) return null;
      const { data } = await supabase.from('agent_messages').select(MESSAGE_COLUMNS).eq('thread_id', id).order('created_at', { ascending: true }).limit(400);
      return { thread: toThread(row), messages: (data ?? []).map(toAgentMessage) };
    },

    async saveExchange({ threadId, title, user, assistant }) {
      let thread: AgentThread | null = null;
      let created = false;
      if (threadId) {
        const { data } = await supabase.from('agent_threads').select('id, title, updated_at').eq('id', threadId).eq('org_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle();
        thread = data ? toThread(data) : null;
      } else {
        const { data } = await supabase.from('agent_threads').insert({ org_id: ctx.org.id, user_id: ctx.user.id, title }).select('id, title, updated_at').single();
        thread = data ? toThread(data) : null;
        created = thread !== null;
      }
      if (!thread) return null;

      // Dates explicites : les deux messages sont écrits dans la même transaction, `now()` serait identique et l'ordre incertain.
      const at = Date.now();
      const { data, error } = await supabase.from('agent_messages').insert([
        { thread_id: thread.id, org_id: ctx.org.id, role: 'user', content: user.text, proposals: [], media_ids: user.mediaIds, created_at: new Date(at).toISOString() },
        { thread_id: thread.id, org_id: ctx.org.id, role: 'assistant', content: assistant.text, proposals: assistant.proposals, media_ids: [], created_at: new Date(at + 1).toISOString() },
      ]).select(MESSAGE_COLUMNS);
      const rows = [...(data ?? [])].sort((a: Row, b: Row) => String(a.created_at).localeCompare(String(b.created_at)));
      if (error || rows.length !== 2) {
        if (created) await supabase.from('agent_threads').delete().eq('id', thread.id);
        return null;
      }
      const [userMessage, assistantMessage] = rows.map(toAgentMessage) as [AgentMessage, AgentMessage];
      return { thread: { ...thread, updatedAt: assistantMessage.createdAt }, user: userMessage, assistant: assistantMessage };
    },

    async updateProposals(messageId, updates) {
      const { data } = await supabase.from('agent_messages').select('proposals').eq('id', messageId).eq('org_id', ctx.org.id).maybeSingle();
      if (!data) return fail(GENERIC_ERROR);
      const next = sanitizeProposals(data.proposals).map((p) => {
        const u = updates.find((x) => x.id === p.id);
        return u ? { ...p, status: u.status, text: u.text, firstComment: u.firstComment, mediaIds: u.mediaIds, publishAt: u.publishAt } : p;
      });
      const { error } = await supabase.from('agent_messages').update({ proposals: next }).eq('id', messageId).eq('org_id', ctx.org.id);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async removeThread(id) {
      const { error } = await supabase.from('agent_threads').delete().eq('id', id).eq('org_id', ctx.org.id).eq('user_id', ctx.user.id);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },
  };

  return { inbox, posts, workspace, media, knowledge, agent, analytics: createSupabaseAnalytics(supabase, ctx) };
}
