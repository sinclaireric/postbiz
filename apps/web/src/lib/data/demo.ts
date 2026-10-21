import { replyWindow, validateReply } from '@/lib/inbox/logic';
import type {
  ConversationDetail, ConversationStatus, ConversationSummary, InboxRepository, MessageItem, NetworkId, NoteItem,
} from '@/lib/inbox/types';
import type {
  AppContext, CreatePostInput, IntegrationItem, KnowledgeInput, KnowledgeItem, KnowledgeRepository, MemberItem, NotificationItem, PostItem, PostsRepository, Repositories, Result, WorkspaceRepository,
} from './types';

// Mode démo : données d'exemple en mémoire, partagées par tous les visiteurs du serveur de développement.
// Les horaires sont calculés à partir du démarrage pour que les fenêtres de 24 h soient réalistes.

const H = 3_600_000;
const M = 60_000;
const T0 = Date.now();
const ago = (ms: number) => new Date(T0 - ms).toISOString();
const ahead = (ms: number) => new Date(T0 + ms).toISOString();

export const DEMO_CONTEXT: AppContext = {
  mode: 'demo',
  user: { id: 'demo-user', email: 'camille@maison-lune.example', name: 'Camille' },
  org: { id: 'demo-org', name: 'Maison Lune', role: 'admin' },
};

interface Store {
  notifications: NotificationItem[];
  conversations: ConversationDetail[];
  integrations: IntegrationItem[];
  members: MemberItem[];
  posts: PostItem[];
  knowledge: KnowledgeItem[];
  orgName: string;
  seq: number;
}

let seq = 100;
const id = (p: string) => `${p}-${++seq}`;

const msg = (direction: 'in' | 'out', body: string, createdAt: string, extra: Partial<MessageItem> = {}): MessageItem => ({
  id: id('m'), direction, body, attachments: [], sentByName: direction === 'out' ? 'Camille' : null,
  deliveryStatus: direction === 'in' ? 'received' : 'sent', error: null, createdAt, ...extra,
});

function seed(): Store {
  const conv = (c: Omit<ConversationDetail, 'notes' | 'lastMessageAt' | 'lastMessagePreview'> & { notes?: NoteItem[] }): ConversationDetail => {
    const last = c.messages[c.messages.length - 1]!;
    return { notes: [], ...c, lastMessageAt: last.createdAt, lastMessagePreview: last.body ?? '[pièce jointe]' };
  };

  const conversations: ConversationDetail[] = [
    conv({
      id: 'c1', networkId: 'instagram', accountName: 'maison.lune', kind: 'dm', contactName: 'Léa Marchand', contactUsername: 'lea.marchand',
      status: 'open', assigneeName: null, unreadCount: 2, replyWindowExpiresAt: ahead(19 * H),
      messages: [
        msg('in', 'Bonjour, vous livrez en Belgique ?', ago(5 * H + 2 * M)),
        msg('in', 'Et en combien de temps ? 🙏', ago(5 * H)),
      ],
    }),
    conv({
      id: 'c2', networkId: 'facebook', accountName: 'Maison Lune', kind: 'dm', contactName: 'Karim Benali', contactUsername: null,
      status: 'pending', assigneeName: 'Hugo', unreadCount: 0, replyWindowExpiresAt: ahead(2 * H + 20 * M),
      messages: [
        msg('in', 'Ma commande n’est toujours pas arrivée, numéro 48213.', ago(21 * H + 40 * M)),
        msg('out', 'Bonjour Karim, je regarde ça tout de suite et je reviens vers vous.', ago(21 * H + 10 * M), { sentByName: 'Hugo' }),
      ],
      notes: [{ id: 'n1', authorName: 'Hugo', body: 'Colis bloqué chez le transporteur, relance faite ce matin.', createdAt: ago(20 * H) }],
    }),
    conv({
      id: 'c3', networkId: 'instagram', accountName: 'maison.lune', kind: 'comment_thread', contactName: 'Sarah', contactUsername: 'sarah_deco',
      status: 'open', assigneeName: null, unreadCount: 1, replyWindowExpiresAt: null,
      messages: [msg('in', 'Trop beau 😍 c’est dispo en vert ?', ago(1 * H + 5 * M))],
    }),
    conv({
      id: 'c4', networkId: 'youtube', accountName: 'Maison Lune TV', kind: 'comment_thread', contactName: 'Atelier Nord', contactUsername: null,
      status: 'open', assigneeName: null, unreadCount: 0, replyWindowExpiresAt: null,
      messages: [
        msg('in', 'Super vidéo, une suite est prévue sur la finition à l’huile ?', ago(3 * H)),
        msg('out', 'Merci ! Oui, elle sort jeudi prochain.', ago(2 * H + 30 * M)),
      ],
    }),
    conv({
      id: 'c5', networkId: 'facebook', accountName: 'Maison Lune', kind: 'dm', contactName: 'Julie Petit', contactUsername: null,
      status: 'open', assigneeName: null, unreadCount: 1, replyWindowExpiresAt: ago(2 * H),
      messages: [msg('in', 'Est-ce que vous avez un magasin à Lyon ?', ago(26 * H))],
    }),
    conv({
      id: 'c6', networkId: 'facebook', accountName: 'Maison Lune', kind: 'comment_thread', contactName: 'Marc Dubois', contactUsername: null,
      status: 'closed', assigneeName: 'Camille', unreadCount: 0, replyWindowExpiresAt: null,
      messages: [
        msg('in', 'Livraison rapide, merci !', ago(50 * H)),
        msg('out', 'Merci Marc, à bientôt !', ago(49 * H)),
      ],
    }),
    conv({
      id: 'c7', networkId: 'instagram', accountName: 'maison.lune', kind: 'dm', contactName: 'Thomas R.', contactUsername: 'thomas.r',
      status: 'open', assigneeName: 'Nora', unreadCount: 0, replyWindowExpiresAt: ahead(11 * H),
      messages: [
        msg('in', 'Je peux modifier l’adresse de livraison ?', ago(13 * H)),
        msg('out', 'Bien sûr, envoyez-moi la nouvelle adresse.', ago(12 * H + 30 * M), { sentByName: 'Nora' }),
        msg('in', '12 rue des Lilas, 59000 Lille', ago(12 * H)),
      ],
    }),
  ];

  const integrations: IntegrationItem[] = [
    { id: 'i1', networkId: 'instagram', name: 'maison.lune', username: '@maison.lune', pictureUrl: null, status: 'active' },
    { id: 'i2', networkId: 'facebook', name: 'Maison Lune', username: null, pictureUrl: null, status: 'active' },
    { id: 'i3', networkId: 'youtube', name: 'Maison Lune TV', username: null, pictureUrl: null, status: 'refresh_needed' },
  ];

  const post = (n: number, networkId: NetworkId, accountName: string, content: string, hours: number, state: PostItem['state'], error: string | null = null, comment: Pick<PostItem, 'firstComment' | 'firstCommentState' | 'firstCommentError'> | null = null): PostItem => ({
    id: `p${n}`, groupId: `g${n}`, networkId, accountName, content,
    publishAt: new Date(T0 + hours * H).toISOString(), state, error, releaseUrl: state === 'published' ? 'https://example.com/post' : null,
    firstComment: comment?.firstComment ?? null, firstCommentState: comment?.firstCommentState ?? null, firstCommentError: comment?.firstCommentError ?? null,
  });

  return {
    conversations, integrations, orgName: DEMO_CONTEXT.org.name, seq,
    notifications: [
      { id: 'nt1', type: 'post_error', title: 'Canal à reconnecter', body: 'Le jeton d’accès a expiré : reconnectez le canal.', createdAt: ago(3 * H), read: false, href: '/app/calendrier' },
      { id: 'nt2', type: 'message_failed', title: 'Réponse non envoyée', body: 'La fenêtre de 24 h est dépassée : Meta n’autorise plus de réponse à cette conversation.', createdAt: ago(26 * H), read: true, href: '/app/inbox?c=c5' },
    ],
    members: [
      { userId: 'demo-user', name: 'Camille', role: 'admin' },
      { userId: 'u2', name: 'Hugo', role: 'member' },
      { userId: 'u3', name: 'Nora', role: 'member' },
      { userId: 'u4', name: 'Léo', role: 'viewer' },
    ],
    posts: [
      post(1, 'facebook', 'Maison Lune', 'Nouvelle collection d’automne : les premières pièces arrivent demain 🍂', -20, 'published', null, { firstComment: 'Dites-nous en commentaire laquelle vous préférez 👇', firstCommentState: 'posted', firstCommentError: null }),
      post(2, 'facebook', 'Maison Lune', 'Atelier ouvert ce samedi, venez découvrir le savoir-faire.', 20, 'queued', null, { firstComment: 'Adresse et horaires : 12 rue des Tanneurs, 10 h – 17 h.', firstCommentState: 'pending', firstCommentError: null }),
      post(3, 'instagram', 'maison.lune', 'Coulisses de l’atelier — épisode 3', 28, 'queued'),
      post(4, 'youtube', 'Maison Lune TV', 'Finition à l’huile : le guide complet', 52, 'draft'),
      post(5, 'facebook', 'Maison Lune', 'Rappel : -10 % jusqu’à dimanche.', -3, 'error', 'Le jeton d’accès a expiré : reconnectez le canal.'),
      post(6, 'linkedin', 'Camille Moreau', 'Trois gestes de l’atelier qui font la durée d’un meuble.', -30, 'published', null, { firstComment: 'Le guide complet est sur notre site (lien en bio).', firstCommentState: 'failed', firstCommentError: 'LinkedIn a refusé le commentaire : accès insuffisant.' }),
    ],
    knowledge: [
      { id: 'k1', title: 'Ton de la marque', updatedAt: ago(30 * H), content: 'Maison Lune est un atelier de mobilier en bois massif, à Lyon. Nous tutoyons nos clients, avec un ton chaleureux et simple. Jamais de jargon ni de promesses exagérées. Nous parlons de matière, de geste et de durée.' },
      { id: 'k2', title: 'Offres en cours', updatedAt: ago(8 * H), content: 'Livraison offerte dès 60 € d’achat en France. -10 % sur la collection d’automne jusqu’à dimanche. Reprise gratuite de l’ancien meuble pour tout achat d’une table.' },
      { id: 'k3', title: 'Questions fréquentes', updatedAt: ago(2 * H), content: 'Délai de fabrication : 3 à 4 semaines. Finitions : huile naturelle ou cire. Garantie 5 ans. Atelier ouvert au public le samedi de 10 h à 17 h.' },
    ],
  };
}

const g = globalThis as unknown as { __postbizDemo?: Store };
const store = (): Store => (g.__postbizDemo ??= seed());

const summary = ({ messages: _m, notes: _n, ...s }: ConversationDetail): ConversationSummary => s;

const inbox: InboxRepository = {
  async listConversations() {
    return store().conversations.map(summary);
  },
  async getConversation(cid) {
    const c = store().conversations.find((x) => x.id === cid);
    return c ? structuredClone(c) : null;
  },
  async sendReply(cid, body) {
    const c = store().conversations.find((x) => x.id === cid);
    if (!c) return { ok: false, error: { key: 'app.inbox.notFound' } };
    const error = validateReply(body, replyWindow(c.replyWindowExpiresAt));
    if (error) return { ok: false, error };
    const m = msg('out', body.trim(), new Date().toISOString(), { sentByName: DEMO_CONTEXT.user.name });
    c.messages.push(m);
    c.lastMessageAt = m.createdAt;
    c.lastMessagePreview = m.body ?? '';
    c.unreadCount = 0;
    return { ok: true };
  },
  async setStatus(cid, status: ConversationStatus) {
    const c = store().conversations.find((x) => x.id === cid);
    if (!c) return { ok: false, error: { key: 'app.inbox.notFound' } };
    c.status = status;
    return { ok: true };
  },
  async markRead(cid) {
    const c = store().conversations.find((x) => x.id === cid);
    if (c) c.unreadCount = 0;
    return { ok: true };
  },
  async addNote(cid, body) {
    const c = store().conversations.find((x) => x.id === cid);
    if (!c) return { ok: false, error: { key: 'app.inbox.notFound' } };
    c.notes.push({ id: id('n'), authorName: DEMO_CONTEXT.user.name, body: body.trim(), createdAt: new Date().toISOString() });
    return { ok: true };
  },
};

const posts: PostsRepository = {
  async list() {
    return [...store().posts].sort((a, b) => (a.publishAt ?? '').localeCompare(b.publishAt ?? ''));
  },
  async create(input: CreatePostInput): Promise<Result> {
    const s = store();
    const groupId = id('g');
    for (const target of input.targets) {
      const integ = s.integrations.find((i) => i.id === target.integrationId);
      if (!integ) return { ok: false, error: { key: 'app.errors.channelNotFound' } };
      s.posts.push({
        id: id('p'), groupId, networkId: integ.networkId, accountName: integ.name, content: input.content.trim(),
        publishAt: input.publishAt, state: input.mode === 'schedule' ? 'queued' : 'draft', error: null, releaseUrl: null,
        firstComment: target.firstComment, firstCommentState: target.firstComment ? 'pending' : null, firstCommentError: null,
      });
    }
    return { ok: true };
  },
  async remove(groupId) {
    const s = store();
    s.posts = s.posts.filter((p) => !(p.groupId === groupId && (p.state === 'draft' || p.state === 'queued' || p.state === 'error')));
    return { ok: true };
  },
  async retryFirstComment(postId) {
    const p = store().posts.find((x) => x.id === postId);
    if (!p || p.state !== 'published' || p.firstCommentState !== 'failed') return { ok: false, error: { key: 'app.errors.generic' } };
    p.firstCommentState = 'pending';
    p.firstCommentError = null;
    return { ok: true };
  },
};

const workspace: WorkspaceRepository = {
  async integrations() { return store().integrations; },
  async members() { return store().members; },
  async renameOrganization(name) { store().orgName = name; return { ok: true }; },
  async notifications() { return structuredClone(store().notifications); },
  async markNotificationsRead() { store().notifications.forEach((n) => { n.read = true; }); return { ok: true }; },
};

/** Mode démo : « connecte » un canal fictif pour pouvoir parcourir l'onboarding sans OAuth. */
export function demoConnectChannel(networkId: NetworkId, name: string): Result {
  const s = store();
  if (s.integrations.some((i) => i.networkId === networkId)) return { ok: true };
  s.integrations.push({ id: id('i'), networkId, name, username: null, pictureUrl: null, status: 'active' });
  return { ok: true };
}

const media = { async list() { return []; } };

const knowledge: KnowledgeRepository = {
  async list() {
    return [...store().knowledge].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async create(input: KnowledgeInput): Promise<Result> {
    store().knowledge.push({ id: id('k'), title: input.title.trim(), content: input.content.trim(), updatedAt: new Date().toISOString() });
    return { ok: true };
  },
  async update(itemId, input) {
    const item = store().knowledge.find((k) => k.id === itemId);
    if (!item) return { ok: false, error: { key: 'app.knowledge.errSave' } };
    Object.assign(item, { title: input.title.trim(), content: input.content.trim(), updatedAt: new Date().toISOString() });
    return { ok: true };
  },
  async remove(itemId) {
    const s = store();
    s.knowledge = s.knowledge.filter((k) => k.id !== itemId);
    return { ok: true };
  },
};

export const demoRepositories: Repositories = { inbox, posts, workspace, media, knowledge };
export const demoOrgName = () => store().orgName;
