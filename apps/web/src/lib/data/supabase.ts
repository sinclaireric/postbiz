import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeProposals } from '@/lib/agent/proposal';
import type { AgentMessage, AgentThread } from '@/lib/agent/types';
import { createSupabaseAnalytics } from '@/lib/analytics/supabase';
import type { KnowledgeHit } from '@/lib/kb/types';
import { GENERIC_ERROR, type FormError } from '@/lib/form-error';
import { replyWindow, validateReply } from '@/lib/inbox/logic';
import { displayName, safeFileName } from '@/lib/media/logic';
import { supportNotificationHref } from '@/lib/support/logic';
import { workspaceError } from '@/lib/workspaces';
import { isMissingFunction } from '@/lib/billing/rpc';
import type {
  ConversationDetail, ConversationStatus, ConversationSummary, InboxRepository, MessageItem, NetworkId, NoteItem,
} from '@/lib/inbox/types';
import { BETA_KNOWLEDGE_LIMITS, KNOWLEDGE_LIMITS, textItem } from './types';
import type {
  AgentRepository, AppContext, CreatePostInput, GenerationRepository, IntegrationItem, KnowledgeInput, KnowledgeItem, KnowledgePage, KnowledgeRepository, MediaItem, MediaRepository, InvitationItem, MemberItem, NotificationItem, OrgRole, PostItem, PostMedia, PostsRepository, ReceivedInvitation, Repositories, Result, SuggestionRepository, VideoJobRecord, WorkspaceRepository,
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
      // `workspace_members` donne aussi les adresses, aux administrateurs seulement. Avant la migration des espaces, on retombe sur la lecture simple.
      const listed = await supabase.rpc('workspace_members', { p_org: ctx.org.id });
      if (!listed.error && Array.isArray(listed.data)) {
        return (listed.data as Row[]).map((m): MemberItem => ({ userId: m.user_id, name: m.name || 'Membre', role: m.role as OrgRole, email: m.email ?? null }));
      }
      const { data } = await supabase.from('memberships').select('user_id, role').eq('org_id', ctx.org.id).order('created_at', { ascending: true });
      const names = await profileNames(supabase, (data ?? []).map((m: Row) => m.user_id));
      return (data ?? []).map((m: Row): MemberItem => ({ userId: m.user_id, name: names.get(m.user_id) ?? 'Membre', role: m.role as OrgRole }));
    },

    // Les notifications sont celles de la personne dans l'espace courant (et celles qui ne sont rattachées à aucun espace).
    async notifications() {
      const { data } = await supabase
        .from('notifications')
        .select('id, type, title, body, data, read_at, created_at')
        .eq('user_id', ctx.user.id)
        .or(`org_id.is.null,org_id.eq.${ctx.org.id}`)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []).map((n: Row): NotificationItem => ({
        id: n.id, type: n.type, title: n.title, body: n.body ?? null, createdAt: n.created_at, read: !!n.read_at,
        href: supportNotificationHref(n.type, n.data) ?? (n.data?.conversationId ? `/app/inbox?c=${encodeURIComponent(String(n.data.conversationId))}` : n.data?.postId ? '/app/calendrier' : null),
      }));
    },

    async markNotificationsRead() {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.user.id).or(`org_id.is.null,org_id.eq.${ctx.org.id}`).is('read_at', null);
      return error ? fail(GENERIC_ERROR) : { ok: true };
    },

    async renameOrganization(name) {
      const { error } = await supabase.from('organizations').update({ name: name.trim() }).eq('id', ctx.org.id);
      return error ? fail({ key: 'app.settings.errRename' }) : { ok: true };
    },

    async create(name, copyMembers) {
      const { data, error } = await supabase.rpc('create_organization', { p_name: name, p_copy_members_from: copyMembers ? ctx.org.id : null });
      return error || typeof data !== 'string' ? { ok: false, error: workspaceError(error?.message) } : { ok: true, id: data };
    },

    async remove() {
      const { error } = await supabase.rpc('delete_workspace', { p_org: ctx.org.id });
      return error ? fail(workspaceError(error.message)) : { ok: true };
    },

    async setMemberRole(userId, role) {
      const { data, error } = await supabase.from('memberships').update({ role }).eq('org_id', ctx.org.id).eq('user_id', userId).select('user_id');
      if (error) return fail(workspaceError(error.message));
      // La RLS ne laisse modifier que les administrateurs : aucune ligne touchée = refus.
      return data && data.length > 0 ? { ok: true } : fail(workspaceError('forbidden'));
    },

    async removeMember(userId) {
      const { data, error } = await supabase.from('memberships').delete().eq('org_id', ctx.org.id).eq('user_id', userId).select('user_id');
      if (error) return fail(workspaceError(error.message));
      return data && data.length > 0 ? { ok: true } : fail(workspaceError('forbidden'));
    },

    async invitations() {
      const { data } = await supabase
        .from('workspace_invitations')
        .select('id, email, role, created_at, expires_at')
        .eq('org_id', ctx.org.id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      return (data ?? []).map((i: Row): InvitationItem => ({ id: i.id, email: i.email, role: i.role as OrgRole, createdAt: i.created_at, expiresAt: i.expires_at }));
    },

    async invite(email, role) {
      const { data, error } = await supabase.rpc('invite_to_workspace', { p_org: ctx.org.id, p_email: email, p_role: role });
      return error || typeof data !== 'string' ? { ok: false, error: workspaceError(error?.message) } : { ok: true, token: data };
    },

    async revokeInvitation(id) {
      const { error } = await supabase.from('workspace_invitations').delete().eq('id', id).eq('org_id', ctx.org.id);
      return error ? fail(workspaceError(error.message)) : { ok: true };
    },

    async receivedInvitations() {
      const { data, error } = await supabase.rpc('my_invitations');
      if (error || !Array.isArray(data)) return [];
      return (data as Row[]).map((i): ReceivedInvitation => ({ id: i.id, orgId: i.org_id, orgName: i.org_name, role: i.role as OrgRole, inviterName: i.inviter_name || null, expiresAt: i.expires_at }));
    },

    async previewInvitation(token) {
      const { data, error } = await supabase.rpc('invitation_preview', { p_token: token });
      const row = !error && Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
      return row
        ? { orgId: row.org_id, orgName: row.org_name, role: row.role as OrgRole, inviterName: row.inviter_name || null, expiresAt: row.expires_at, alreadyMember: row.already_member === true }
        : null;
    },

    async acceptInvitation(token) {
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
      return error || typeof data !== 'string' ? { ok: false, error: workspaceError(error?.message) } : { ok: true, orgId: data };
    },

    async acceptReceivedInvitation(id) {
      const { data, error } = await supabase.rpc('accept_invitation_by_id', { p_id: id });
      return error || typeof data !== 'string' ? { ok: false, error: workspaceError(error?.message) } : { ok: true, orgId: data };
    },

    async declineReceivedInvitation(id) {
      const { error } = await supabase.rpc('decline_invitation', { p_id: id });
      return error ? fail(workspaceError(error.message)) : { ok: true };
    },
  };

  const KNOWLEDGE_COLUMNS = 'id, title, content, updated_at, pinned, chunk_count, indexed_at, embedded_at, kind, status, url, file_path, size_bytes, error, stats, config, synced_at, run_at';
  const KNOWLEDGE_LIST_MAX = 1_000;
  /** Le nom d'origine d'un fichier : son chemin « <organisation>/<identifiant>-<nom> » sans le dossier ni l'identifiant. */
  const fileNameOf = (path: string | null): string | null =>
    path ? path.replace(/^[^/]*\//, '').replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') : null;
  const toKnowledge = (k: Row): KnowledgeItem => {
    const config = (k.config ?? {}) as Row;
    return textItem({
      id: k.id, title: k.title, content: k.content ?? '', updatedAt: k.updated_at, pinned: k.pinned !== false, chunkCount: k.chunk_count ?? 0,
      indexedAt: k.indexed_at ?? null, embeddedAt: k.embedded_at ?? null,
      kind: k.kind === 'file' || k.kind === 'website' ? k.kind : 'text',
      status: k.status === 'pending' || k.status === 'processing' || k.status === 'failed' ? k.status : 'ready',
      url: k.url ?? null, fileName: fileNameOf(k.file_path ?? null), sizeBytes: k.size_bytes === null || k.size_bytes === undefined ? null : Number(k.size_bytes),
      error: typeof k.error === 'string' ? k.error : null, stats: (k.stats ?? {}) as KnowledgeItem['stats'],
      scope: k.kind === 'website' ? (config.scope === 'page' ? 'page' : 'site') : null, autoSync: config.autoSync !== false,
      syncedAt: k.synced_at ?? null, runAt: k.run_at ?? null,
    });
  };
  /** Le message d'une exception de la base (les fonctions `knowledge_*` lèvent des codes lisibles), en erreur de formulaire traduisible. */
  const sourceError = (message: string | undefined): FormError => {
    const m = message ?? '';
    // Un refus de plafond porte le plafond de l'offre (« knowledge_files_limit:20 ») ; sans nombre, celui de la bêta.
    const cap = (code: string, fallback: number) => Number(new RegExp(`${code}:(\\d+)`).exec(m)?.[1] ?? fallback);
    const known: [string, FormError][] = [
      ['knowledge_items_limit', { key: 'app.knowledge.errLimit', params: { max: cap('knowledge_items_limit', BETA_KNOWLEDGE_LIMITS.sources) } }],
      ['knowledge_files_limit', { key: 'app.knowledgePage.errors.filesLimit', params: { max: cap('knowledge_files_limit', BETA_KNOWLEDGE_LIMITS.files) } }],
      ['knowledge_sites_limit', { key: 'app.knowledgePage.errors.sitesLimit', params: { max: cap('knowledge_sites_limit', BETA_KNOWLEDGE_LIMITS.sites) } }],
      ['knowledge_daily_limit', { key: 'app.knowledgePage.errors.dailyLimit' }],
      ['knowledge_duplicate', { key: 'app.knowledgePage.errors.duplicate' }],
      ['knowledge_invalid_url', { key: 'app.knowledgePage.errors.invalidUrl' }],
      ['knowledge_invalid_scope', { key: 'app.knowledgePage.errors.invalidUrl' }],
      ['knowledge_file_too_large', { key: 'app.knowledgePage.errors.fileTooLarge', params: { max: Math.round(KNOWLEDGE_LIMITS.fileBytes / 1_048_576) } }],
      ['knowledge_unsupported_type', { key: 'app.knowledgePage.errors.unsupportedType' }],
      ['knowledge_file_missing', { key: 'app.knowledgePage.errors.fileMissing' }],
      ['knowledge_invalid_path', { key: 'app.knowledgePage.errors.fileMissing' }],
      ['knowledge_sync_too_soon', { key: 'app.knowledgePage.errors.syncTooSoon' }],
    ];
    return known.find(([code]) => m.includes(code))?.[1] ?? { key: 'app.knowledge.errSave' };
  };

  const knowledge: KnowledgeRepository = {
    async list() {
      // La base refuse les sources au-delà du plafond de l'offre : ce plafond-ci est celui d'une lecture, large pour qu'aucune offre ne soit coupée.
      const { data } = await supabase
        .from('knowledge_items')
        .select(KNOWLEDGE_COLUMNS)
        .eq('org_id', ctx.org.id)
        .order('updated_at', { ascending: false })
        .limit(KNOWLEDGE_LIST_MAX);
      return (data ?? []).map(toKnowledge);
    },

    async limits() {
      const { data, error } = await supabase.rpc('knowledge_org_limits', { p_org: ctx.org.id });
      const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
      const count = (v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : fallback);
      // Une base sans la fonction (migration pas encore appliquée) a les plafonds de la bêta : c'est ce qu'elle applique.
      if (error || !row) return { ...BETA_KNOWLEDGE_LIMITS };
      return {
        sources: count(row.sources, BETA_KNOWLEDGE_LIMITS.sources), files: count(row.files, BETA_KNOWLEDGE_LIMITS.files), sites: count(row.sites, BETA_KNOWLEDGE_LIMITS.sites),
        upgradable: row.upgradable === true,
      };
    },

    async create(input: KnowledgeInput) {
      const { data, error } = await supabase.from('knowledge_items').insert({
        org_id: ctx.org.id, title: input.title.trim(), content: input.content.trim(), created_by: ctx.user.id,
      }).select('id').single();
      if (error?.message?.includes('knowledge_items_limit')) return fail(sourceError(error.message));
      return error || !data ? fail({ key: 'app.knowledge.errSave' }) : { ok: true, id: data.id as string };
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

    async setPinned(id, pinned) {
      const { data, error } = await supabase.from('knowledge_items').update({ pinned }).eq('id', id).eq('org_id', ctx.org.id).select('id');
      return error || !data?.length ? fail({ key: 'app.knowledge.errSave' }) : { ok: true };
    },

    async remove(id) {
      const { data: row } = await supabase.from('knowledge_items').select('kind, file_path').eq('id', id).eq('org_id', ctx.org.id).maybeSingle();
      const { error } = await supabase.from('knowledge_items').delete().eq('id', id).eq('org_id', ctx.org.id);
      if (error) return fail({ key: 'app.knowledge.errSave' });
      // Le fichier d'un document part avec lui (les passages partent avec la ligne, en cascade) ; un fichier orphelin n'est pas grave, on ne s'en inquiète pas.
      if (row?.kind === 'file' && typeof row.file_path === 'string') await supabase.storage.from('knowledge').remove([row.file_path]).catch(() => undefined);
      return { ok: true };
    },

    async replaceChunks(itemId, chunks) {
      // Une seule fonction côté base : elle contrôle le rôle de l'appelant et les plafonds, et remplace les passages d'un bloc.
      const { error } = await supabase.rpc('knowledge_replace_chunks', { p_item: itemId, p_chunks: chunks.map((c) => ({ content: c.content, embedding: c.embedding, meta: c.meta })) });
      if (error?.message?.includes('knowledge_chunks_limit')) return fail({ key: 'app.knowledge.errChunks' });
      return error ? fail({ key: 'app.knowledge.errIndex' }) : { ok: true };
    },

    async search(q) {
      const { data, error } = await supabase.rpc('knowledge_search', { p_org: ctx.org.id, p_embedding: q.embedding, p_terms: q.terms, p_limit: q.limit, p_per_item: q.perItem, p_exclude: q.exclude });
      if (error) throw new Error(`knowledge_search : ${error.code ?? 'erreur'}`);
      return ((data ?? []) as Row[]).map((r): KnowledgeHit => {
        const meta = (r.meta ?? {}) as Row;
        const pages = Array.isArray(meta.pages) && meta.pages.length === 2 ? ([Number(meta.pages[0]), Number(meta.pages[1])] as [number, number]) : null;
        return {
          chunkId: r.chunk_id, itemId: r.item_id, title: r.title, content: r.content, heading: typeof meta.heading === 'string' ? meta.heading : null,
          url: typeof meta.url === 'string' ? meta.url : null, pageTitle: typeof meta.title === 'string' ? meta.title : null, pages,
          similarity: Number(r.similarity) || 0, termHits: Number(r.term_hits) || 0, score: Number(r.score) || 0,
        };
      });
    },

    async addFile(input) {
      const { data, error } = await supabase.rpc('knowledge_add_file', { p_org: ctx.org.id, p_path: input.path, p_title: input.title, p_size: input.size });
      return error || !data ? fail(sourceError(error?.message)) : { ok: true, id: String(data) };
    },

    async addWebsite(input) {
      const { data, error } = await supabase.rpc('knowledge_add_website', {
        p_org: ctx.org.id, p_url: input.url, p_title: input.title, p_scope: input.scope, p_auto_sync: input.autoSync,
      });
      return error || !data ? fail(sourceError(error?.message)) : { ok: true, id: String(data) };
    },

    async requestSync(id) {
      const { error } = await supabase.rpc('knowledge_request_sync', { p_item: id });
      return error ? fail(sourceError(error.message)) : { ok: true };
    },

    async pages(id): Promise<KnowledgePage[]> {
      const { data } = await supabase.rpc('knowledge_source_pages', { p_item: id });
      return ((data ?? []) as Row[]).map((r) => ({ url: String(r.url), title: typeof r.title === 'string' && r.title ? r.title : String(r.url), chunks: Number(r.chunks) || 0 }));
    },
  };

  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((m: unknown): m is string => typeof m === 'string') : []);
  const toThread = (r: Row): AgentThread => ({ id: r.id, title: r.title, updatedAt: r.updated_at });
  const toAgentMessage = (r: Row): AgentMessage => ({
    id: r.id, role: r.role === 'assistant' ? 'assistant' : 'user', text: r.content ?? '', proposals: sanitizeProposals(r.proposals),
    mediaIds: strings(r.media_ids), jobIds: strings(r.job_ids), createdAt: r.created_at,
  });
  const MESSAGE_COLUMNS = 'id, role, content, proposals, media_ids, job_ids, created_at';

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
        { thread_id: thread.id, org_id: ctx.org.id, role: 'user', content: user.text, proposals: [], media_ids: user.mediaIds, job_ids: [], created_at: new Date(at).toISOString() },
        { thread_id: thread.id, org_id: ctx.org.id, role: 'assistant', content: assistant.text, proposals: assistant.proposals, media_ids: assistant.mediaIds, job_ids: assistant.jobIds, created_at: new Date(at + 1).toISOString() },
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

  // ---------------------------------------------------------------- génération d'images et de vidéos (agent)
  const JOB_COLUMNS = 'id, status, orientation, prompt, media_id, error, provider_task_id, claimed_at, created_at';
  const toJob = (r: Row): VideoJobRecord => ({
    id: r.id, status: r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'pending', orientation: r.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    prompt: r.prompt, mediaId: r.media_id ?? null, error: r.error ?? null, createdAt: r.created_at, providerTaskId: r.provider_task_id, claimedAt: r.claimed_at ?? null,
  });

  const generation: GenerationRepository = {
    async reserve(kind, limit) {
      // Limite mensuelle de l'offre d'abord, puis plafond journalier anti-abus (`ai_media_reserve`).
      const { data, error } = await supabase.rpc('ai_media_reserve', { p_org: ctx.org.id, p_kind: kind, p_daily_limit: limit });
      if (isMissingFunction(error)) {
        // Migration de facturation pas encore appliquée : seul le plafond journalier d'avant existe.
        const legacy = await supabase.rpc('ai_generation_reserve', { p_org: ctx.org.id, p_kind: kind, p_limit: limit });
        return !legacy.error && legacy.data === true;
      }
      if (error) return false;
      return data === 'ok' ? true : data === 'monthly' ? 'monthly' : false;
    },

    async reserveText(feature) {
      const { data, error } = await supabase.rpc('ai_text_reserve', { p_org: ctx.org.id, p_feature: feature });
      // Sans la migration de facturation, il n'y a pas de quota à appliquer (bêta gratuite) : on laisse passer plutôt que de tout refuser.
      if (isMissingFunction(error)) return true;
      return !error && data === true;
    },

    async createMedia(input) {
      // Même convention de chemin que les envois du navigateur : « <organisation>/<uuid>-<nom> » dans le bucket privé « media ».
      const path = `${ctx.org.id}/${crypto.randomUUID()}-${safeFileName(input.name)}`;
      const up = await supabase.storage.from('media').upload(path, input.bytes, { contentType: input.mimeType, upsert: false });
      if (up.error) return null;
      const { data, error } = await supabase.from('media').insert({
        org_id: ctx.org.id, bucket: 'media', path, name: input.name.slice(0, 255), mime_type: input.mimeType, size_bytes: input.bytes.byteLength,
        width: input.width, height: input.height, duration_seconds: input.durationSeconds, alt: input.alt.trim() ? input.alt.trim().slice(0, 1500) : null,
        status: 'ready', created_by: ctx.user.id,
      }).select(MEDIA_COLUMNS).single();
      if (error || !data) {
        await supabase.storage.from('media').remove([path]); // pas de fichier orphelin
        return null;
      }
      return (await toMediaItems([data as Row]))[0] ?? null;
    },

    async activeJobs() {
      const { count } = await supabase.from('ai_video_jobs').select('id', { count: 'exact', head: true }).eq('org_id', ctx.org.id).eq('created_by', ctx.user.id).in('status', ['pending', 'saving']);
      return count ?? 0;
    },

    async createJob(input) {
      const { data, error } = await supabase.from('ai_video_jobs').insert({
        org_id: ctx.org.id, created_by: ctx.user.id, prompt: input.prompt, orientation: input.orientation, provider_task_id: input.providerTaskId, reference_media_ids: input.referenceMediaIds,
      }).select(JOB_COLUMNS).single();
      return error || !data ? null : toJob(data as Row);
    },

    async jobs(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];
      const { data } = await supabase.from('ai_video_jobs').select(JOB_COLUMNS).eq('org_id', ctx.org.id).eq('created_by', ctx.user.id).in('id', unique);
      const byId = new Map(((data ?? []) as Row[]).map((r) => [r.id as string, toJob(r)]));
      return ids.map((id) => byId.get(id)).filter((j): j is VideoJobRecord => !!j);
    },

    async claimJob(id, staleBefore) {
      // Un seul UPDATE conditionnel : la base ne laisse passer qu'une des requêtes qui arrivent en même temps.
      const { data } = await supabase.from('ai_video_jobs').update({ status: 'saving', claimed_at: new Date().toISOString() })
        .eq('id', id).eq('org_id', ctx.org.id).eq('created_by', ctx.user.id)
        .or(`status.eq.pending,and(status.eq.saving,claimed_at.lt.${staleBefore})`).select('id');
      return (data?.length ?? 0) === 1;
    },

    async settleJob(id, result) {
      const patch = result.status === 'completed' ? { status: 'completed', media_id: result.mediaId, error: null, claimed_at: null }
        : result.status === 'failed' ? { status: 'failed', error: result.error.slice(0, 500), claimed_at: null }
        : { status: 'pending', claimed_at: null };
      const { data } = await supabase.from('ai_video_jobs').update(patch).eq('id', id).eq('org_id', ctx.org.id).eq('created_by', ctx.user.id).select('id');
      return (data?.length ?? 0) === 1;
    },
  };

  // ---------------------------------------------------------------- suggestions de réponse (inbox)
  const suggestions: SuggestionRepository = {
    async countToday() {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const { count } = await supabase.from('ai_reply_suggestions').select('id', { count: 'exact', head: true }).eq('org_id', ctx.org.id).gte('created_at', since);
      return count ?? 0;
    },

    async log(i) {
      const { data, error } = await supabase.from('ai_reply_suggestions').insert({
        org_id: ctx.org.id, conversation_id: i.conversationId, user_id: ctx.user.id, reply: i.reply, grounded: i.grounded, needs_human: i.needsHuman,
        sources: i.sources.map((title) => ({ title })), model: i.model, input_tokens: i.inputTokens, output_tokens: i.outputTokens,
      }).select('id').single();
      return error || !data ? null : (data.id as string);
    },

    async reply(id) {
      const { data } = await supabase.from('ai_reply_suggestions').select('reply').eq('id', id).eq('org_id', ctx.org.id).maybeSingle();
      return typeof data?.reply === 'string' ? data.reply : null;
    },

    async settle(id, outcome) {
      // Une seule fois : une suggestion déjà marquée n'est pas remise en cause.
      await supabase.from('ai_reply_suggestions').update({ outcome }).eq('id', id).eq('org_id', ctx.org.id).eq('user_id', ctx.user.id).is('outcome', null);
    },
  };

  return { inbox, posts, workspace, media, knowledge, agent, generation, suggestions, analytics: createSupabaseAnalytics(supabase, ctx) };
}
