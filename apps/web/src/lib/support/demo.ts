import { SUPPORT_PAGE_SIZE, SUPPORT_REPLY_MAX, SUPPORT_THREAD_LIMIT, SUPPORT_USER_MAX, checkSendLimits, cleanSupportBody, validateSupportBody } from './logic';
import type {
  AdminSupportConversation, AdminSupportRow, AdminSupportSummary, AdminSupportThread, SupportAuthor, SupportErrorCode, SupportFilter, SupportMessage, SupportStatus, SupportThread,
} from './types';
import { EMPTY_THREAD } from './types';

// Chat de support en mode démo (sans Supabase) : les conversations vivent en mémoire du serveur, partagées entre le chat de l'utilisateur et l'espace propriétaire
// (qui est ouvert à tous en démonstration) : on peut écrire d'un côté et répondre de l'autre. Rien n'est envoyé à personne, tout disparaît au redémarrage.
// Les mêmes règles que la base : nettoyage du texte, 2 000 / 4 000 caractères, 5 messages par minute, 20 sans réponse, compteurs de non-lus.

interface Conv {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  orgName: string | null;
  status: SupportStatus;
  supportUnread: number;
  userUnread: number;
  lastAuthor: SupportAuthor;
  createdAt: string;
  lastMessageAt: string;
  resolvedAt: string | null;
  messages: SupportMessage[];
}

const g = globalThis as unknown as { __postbizDemoSupport?: { convs: Conv[]; seq: number } };
const MIN = 60_000;
const HOUR = 60 * MIN;

function seed(now: number): Conv[] {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const conv = (n: number, o: Omit<Conv, 'id' | 'createdAt' | 'lastMessageAt' | 'lastAuthor' | 'userUnread' | 'resolvedAt' | 'supportUnread'> & Partial<Pick<Conv, 'userUnread' | 'resolvedAt'>>): Conv => {
    const last = o.messages.at(-1)!;
    return {
      id: `00000000-0000-4000-a000-00000000010${n}`, createdAt: o.messages[0]!.createdAt, lastMessageAt: last.createdAt, lastAuthor: last.author,
      supportUnread: 0, userUnread: 0, resolvedAt: null, ...o,
    };
  };
  const m = (n: string, author: SupportAuthor, ms: number, body: string): SupportMessage => ({ id: `00000000-0000-4000-b000-${n.padStart(12, '0')}`, author, body, createdAt: ago(ms) });
  const unread = conv(1, {
    userId: 'demo-u-lea', name: 'Léa Martin', email: 'lea@atelier-lune.example', orgName: 'Atelier Lune', status: 'open',
    messages: [m('1', 'user', 25 * MIN, 'Bonjour, mon canal Instagram affiche « à reconnecter » depuis ce matin.'), m('2', 'user', 24 * MIN, 'J’ai essayé de le reconnecter deux fois, sans succès.')],
  });
  unread.supportUnread = 2;
  const waiting = conv(2, {
    userId: 'demo-u-hugo', name: 'Hugo Bernard', email: 'hugo@maison-verte.example', orgName: 'Maison Verte', status: 'open',
    messages: [m('3', 'user', 5 * HOUR, 'Est-ce que je peux programmer des vidéos sur YouTube ?'), m('4', 'support', 4 * HOUR, 'Oui : l’envoi de vidéos est pris en charge, en privé par défaut. Dites-moi si vous voulez que je vous guide.'), m('5', 'user', 3 * HOUR, 'Parfait, merci. Et pour les Shorts ?')],
  });
  const resolved = conv(3, {
    userId: 'demo-u-ines', name: 'Inès Dubois', email: 'ines@cafe-du-port.example', orgName: 'Café du Port', status: 'resolved', resolvedAt: ago(2 * 24 * HOUR),
    messages: [m('6', 'user', 3 * 24 * HOUR, 'Comment inviter ma collègue dans mon espace ?'), m('7', 'support', 3 * 24 * HOUR - 20 * MIN, 'Réglages → Membres → Inviter : copiez le lien et envoyez-le-lui. Il est valable 7 jours.'), m('8', 'user', 2 * 24 * HOUR - HOUR, 'C’est bon, elle a rejoint. Merci !')],
  });
  return [unread, waiting, resolved];
}

function store(now = Date.now()): { convs: Conv[]; seq: number } {
  return (g.__postbizDemoSupport ??= { convs: seed(now), seq: 100 });
}

/** Remet le mode démo dans son état d'origine (tests). */
export function resetDemoSupport(now = Date.now()): void {
  g.__postbizDemoSupport = { convs: seed(now), seq: 100 };
}

const messageId = (s: { seq: number }) => `00000000-0000-4000-b000-${String(++s.seq).padStart(12, '0')}`;
// Plage `a001` : distincte de celle des conversations d'exemple (`a000`), pour qu'une nouvelle conversation ne reprenne jamais leur identifiant.
const conversationIdFor = (s: { seq: number }) => `00000000-0000-4000-a001-${String(++s.seq).padStart(12, '0')}`;

// ---------------------------------------------------------------- côté utilisateur

export function demoThread(userId: string): SupportThread {
  const c = store().convs.find((x) => x.userId === userId);
  return c ? { conversationId: c.id, status: c.status, unread: c.userUnread, messages: structuredClone(c.messages.slice(-SUPPORT_THREAD_LIMIT)) } : EMPTY_THREAD;
}

export function demoUnread(userId: string): number {
  return store().convs.find((x) => x.userId === userId)?.userUnread ?? 0;
}

export function demoMarkRead(userId: string): void {
  const c = store().convs.find((x) => x.userId === userId);
  if (c) c.userUnread = 0;
}

export function demoSend(user: { id: string; name: string; email: string }, orgName: string, body: string, now = Date.now()): { ok: true } | { ok: false; code: SupportErrorCode } {
  const clean = cleanSupportBody(body);
  const invalid = validateSupportBody(clean, SUPPORT_USER_MAX);
  if (invalid) return { ok: false, code: invalid };
  const s = store(now);
  let c = s.convs.find((x) => x.userId === user.id);
  const limited = checkSendLimits(c?.messages ?? [], now);
  if (limited) return { ok: false, code: limited };
  const at = new Date(now).toISOString();
  if (!c) {
    c = { id: conversationIdFor(s), userId: user.id, name: user.name, email: user.email, orgName, status: 'open', supportUnread: 0, userUnread: 0, lastAuthor: 'user', createdAt: at, lastMessageAt: at, resolvedAt: null, messages: [] };
    s.convs.push(c);
  }
  c.messages.push({ id: messageId(s), author: 'user', body: clean, createdAt: at });
  Object.assign(c, { status: 'open', resolvedAt: null, orgName, supportUnread: c.supportUnread + 1, lastAuthor: 'user', lastMessageAt: at });
  return { ok: true };
}

// ---------------------------------------------------------------- espace propriétaire

const lastBody = (c: Conv) => c.messages.at(-1)?.body.slice(0, 200) ?? '';

const row = (c: Conv): AdminSupportRow => ({
  id: c.id, userId: c.userId, name: c.name, email: c.email, orgName: c.orgName, status: c.status, supportUnread: c.supportUnread, userUnread: c.userUnread,
  messageCount: c.messages.length, lastMessageAt: c.lastMessageAt, lastAuthor: c.lastAuthor, lastBody: lastBody(c), createdAt: c.createdAt,
});

export function demoSummary(): AdminSupportSummary {
  const convs = store().convs;
  return {
    all: convs.length, open: convs.filter((c) => c.status === 'open').length, resolved: convs.filter((c) => c.status === 'resolved').length,
    unread: convs.filter((c) => c.supportUnread > 0).length, unreadMessages: convs.reduce((n, c) => n + c.supportUnread, 0),
  };
}

export function demoList(filter: SupportFilter, search: string, page: number): { rows: AdminSupportRow[]; total: number } {
  const needle = search.trim().toLowerCase();
  const matches = store().convs
    .filter((c) => filter === 'all' || (filter === 'unread' ? c.supportUnread > 0 : c.status === filter))
    .filter((c) => !needle || [c.email, c.name, c.orgName].some((v) => v?.toLowerCase().includes(needle)) || c.messages.some((m) => m.body.toLowerCase().includes(needle)))
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt) || (a.id < b.id ? -1 : 1));
  return { rows: matches.slice((page - 1) * SUPPORT_PAGE_SIZE, page * SUPPORT_PAGE_SIZE).map(row), total: matches.length };
}

const conversationOf = (c: Conv): AdminSupportConversation => ({
  id: c.id, userId: c.userId, name: c.name, email: c.email, orgName: c.orgName, status: c.status, supportUnread: c.supportUnread, userUnread: c.userUnread,
  createdAt: c.createdAt, lastMessageAt: c.lastMessageAt, resolvedAt: c.resolvedAt,
});

export function demoAdminThread(id: string): AdminSupportThread | null {
  const c = store().convs.find((x) => x.id === id);
  return c ? { conversation: conversationOf(c), messages: structuredClone(c.messages.slice(-SUPPORT_THREAD_LIMIT)), truncated: c.messages.length > SUPPORT_THREAD_LIMIT } : null;
}

export function demoAdminMarkRead(id: string): void {
  const c = store().convs.find((x) => x.id === id);
  if (c) c.supportUnread = 0;
}

export function demoAdminReply(id: string, body: string, now = Date.now()): { ok: true } | { ok: false; code: SupportErrorCode | 'not_found' } {
  const clean = cleanSupportBody(body);
  const invalid = validateSupportBody(clean, SUPPORT_REPLY_MAX);
  if (invalid) return { ok: false, code: invalid };
  const s = store(now);
  const c = s.convs.find((x) => x.id === id);
  if (!c) return { ok: false, code: 'not_found' };
  const at = new Date(now).toISOString();
  c.messages.push({ id: messageId(s), author: 'support', body: clean, createdAt: at });
  Object.assign(c, { userUnread: c.userUnread + 1, supportUnread: 0, lastAuthor: 'support', lastMessageAt: at });
  return { ok: true };
}

export function demoAdminSetStatus(id: string, status: SupportStatus, now = Date.now()): boolean {
  const c = store(now).convs.find((x) => x.id === id);
  if (!c) return false;
  c.status = status;
  c.resolvedAt = status === 'resolved' ? (c.resolvedAt ?? new Date(now).toISOString()) : null;
  if (status === 'resolved') c.supportUnread = 0;
  return true;
}
