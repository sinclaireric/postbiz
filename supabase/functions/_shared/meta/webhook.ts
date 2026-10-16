// Normalisation des webhooks Meta (Messenger, Instagram, commentaires Facebook et Instagram)
// vers un format commun, indépendant du réseau.
//
// ⚠️ Les formes de charge utile ci-dessous viennent de la documentation Meta et n'ont pas encore été
// validées avec de vrais comptes de test : à confirmer avec les événements « Tester » du tableau de bord Meta.

export type MetaProvider = 'facebook' | 'instagram';

export interface NormalizedEvent {
  provider: MetaProvider;
  /** Identifiant de la Page / du compte pro qui reçoit : correspond à `integrations.internal_id`. */
  accountId: string;
  kind: 'dm' | 'comment_thread';
  conversationExternalId: string;
  contact: { id: string; name?: string; username?: string };
  messageExternalId: string;
  direction: 'in' | 'out';
  body: string | null;
  attachments: { type: string; url?: string }[];
  sentAt: string; // ISO 8601
  targetExternalId?: string; // commentaires : publication ou média commenté
}

type Json = Record<string, any>;

const iso = (ts: unknown, unit: 'ms' | 's'): string => {
  const n = Number(ts);
  const ms = Number.isFinite(n) && n > 0 ? (unit === 's' ? n * 1000 : n) : Date.now();
  return new Date(ms).toISOString();
};

function normalizeMessaging(provider: MetaProvider, accountId: string, m: Json): NormalizedEvent | null {
  const message = m.message as Json | undefined;
  if (!message?.mid) return null; // accusés de réception, lectures, postbacks... ignorés
  const echo = message.is_echo === true;
  const contactId = String(echo ? m.recipient?.id : m.sender?.id ?? '');
  if (!contactId) return null;
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.map((a: Json) => ({ type: String(a.type ?? 'file'), url: a.payload?.url as string | undefined }))
    : [];
  return {
    provider,
    accountId,
    kind: 'dm',
    conversationExternalId: `${accountId}:${contactId}`,
    contact: { id: contactId },
    messageExternalId: String(message.mid),
    direction: echo ? 'out' : 'in',
    body: typeof message.text === 'string' ? message.text : null,
    attachments,
    sentAt: iso(m.timestamp, 'ms'),
  };
}

function normalizeFacebookFeed(accountId: string, v: Json): NormalizedEvent | null {
  if (v.item !== 'comment' || v.verb !== 'add' || !v.comment_id) return null;
  const postId = String(v.post_id ?? '');
  const parentId = String(v.parent_id ?? '');
  const isTopLevel = !parentId || parentId === postId;
  const fromId = String(v.from?.id ?? '');
  if (!fromId) return null;
  const mine = fromId === accountId;
  return {
    provider: 'facebook',
    accountId,
    kind: 'comment_thread',
    conversationExternalId: isTopLevel ? String(v.comment_id) : parentId,
    contact: { id: fromId, name: v.from?.name },
    messageExternalId: String(v.comment_id),
    direction: mine ? 'out' : 'in',
    body: typeof v.message === 'string' ? v.message : null,
    attachments: v.photo ? [{ type: 'image', url: String(v.photo) }] : [],
    sentAt: iso(v.created_time, 's'),
    targetExternalId: postId || undefined,
  };
}

function normalizeInstagramComment(accountId: string, v: Json, entryTime: unknown): NormalizedEvent | null {
  if (!v.id || !v.from?.id) return null;
  const fromId = String(v.from.id);
  return {
    provider: 'instagram',
    accountId,
    kind: 'comment_thread',
    conversationExternalId: String(v.parent_id ?? v.id),
    contact: { id: fromId, username: v.from?.username },
    messageExternalId: String(v.id),
    direction: fromId === accountId ? 'out' : 'in',
    body: typeof v.text === 'string' ? v.text : null,
    attachments: [],
    sentAt: iso(entryTime, 's'),
    targetExternalId: v.media?.id ? String(v.media.id) : undefined,
  };
}

/** Transforme le corps d'un webhook Meta en événements normalisés. Ignore silencieusement ce qu'il ne gère pas. */
export function normalizeMetaWebhook(body: unknown): NormalizedEvent[] {
  const root = body as Json;
  const provider: MetaProvider | null = root?.object === 'page' ? 'facebook' : root?.object === 'instagram' ? 'instagram' : null;
  if (!provider || !Array.isArray(root.entry)) return [];

  const events: NormalizedEvent[] = [];
  for (const entry of root.entry as Json[]) {
    const accountId = String(entry.id ?? '');
    if (!accountId) continue;

    for (const m of (entry.messaging ?? []) as Json[]) {
      const e = normalizeMessaging(provider, accountId, m);
      if (e) events.push(e);
    }
    for (const change of (entry.changes ?? []) as Json[]) {
      const e =
        provider === 'facebook' && change.field === 'feed'
          ? normalizeFacebookFeed(accountId, change.value ?? {})
          : provider === 'instagram' && change.field === 'comments'
            ? normalizeInstagramComment(accountId, change.value ?? {}, entry.time)
            : null;
      if (e) events.push(e);
    }
  }
  return events;
}
