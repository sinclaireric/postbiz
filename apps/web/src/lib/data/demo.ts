import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { AgentMessage, AgentThread } from '@/lib/agent/types';
import { demoDailyRows } from '@/lib/analytics/demo';
import { chunkKnowledge } from '@/lib/kb/chunk';
import { queueCounts } from '@/lib/analytics/logic';
import type { AnalyticsRepository } from '@/lib/analytics/types';
import { replyWindow, validateReply } from '@/lib/inbox/logic';
import type {
  ConversationDetail, ConversationStatus, ConversationSummary, InboxRepository, MessageItem, NetworkId, NoteItem,
} from '@/lib/inbox/types';
import type { FormError } from '@/lib/form-error';
import { adminCount, canCreateWorkspace, INVITATION_DAYS, MAX_PENDING_INVITATIONS, MAX_WORKSPACES } from '@/lib/workspaces';
import type {
  AgentRepository, AppContext, CreatePostInput, GenerationRepository, IntegrationItem, InvitationItem, InvitationPreview, KnowledgeInput, KnowledgeItem, KnowledgeRepository, MediaItem, MediaRepository, MemberItem, NotificationItem, OrgRole, PostItem, PostsRepository, ReceivedInvitation, Repositories, Result, SuggestionRepository, VideoJobRecord, WorkspaceRepository, WorkspaceSummary,
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
  workspaces: [{ id: 'demo-org', name: 'Maison Lune', role: 'admin' }],
};

interface Store {
  notifications: NotificationItem[];
  conversations: ConversationDetail[];
  integrations: IntegrationItem[];
  members: MemberItem[];
  posts: PostItem[];
  knowledge: KnowledgeItem[];
  /** Passages de la recherche (sans vecteur : la démo ne fait aucun appel à l'IA, elle cherche par les mots). */
  knowledgeChunks: { itemId: string; ord: number; content: string; heading: string | null }[];
  media: MediaItem[];
  /** Conversations de l'agent (la plus récente en dernier). */
  agentThreads: { thread: AgentThread; messages: AgentMessage[] }[];
  /** Vidéos « générées » de la démo : aucun fournisseur n'est appelé, la tâche se termine seule après quelques secondes. */
  videoJobs: VideoJobRecord[];
  /** Générations lancées depuis l'ouverture de la démo (pour le plafond journalier). */
  generations: { kind: 'image' | 'video'; at: number }[];
  /** Suggestions de réponse de l'inbox (démo : texte simulé). */
  suggestions: { id: string; at: number; reply: string; outcome: 'sent' | 'edited' | null }[];
  /** Invitations en attente dans cet espace, avec leur jeton (la démo n'a pas de base : il n'y a rien à hacher). */
  invitations: DemoInvitation[];
  orgName: string;
  seq: number;
}

interface DemoInvitation { id: string; email: string; role: OrgRole; token: string; createdAt: string; expiresAt: string }

/** Illustration d'exemple (SVG en data URI) pour la bibliothèque de la démo : aucun fichier à servir, rien à envoyer. */
function art(a: string, b: string, shape: 'moon' | 'wave' | 'arch' | 'sun' | 'dots' | 'tri'): string {
  const shapes: Record<typeof shape, string> = {
    moon: '<circle cx="540" cy="620" r="250" fill="#fafaf7"/><circle cx="640" cy="560" r="230" fill="url(#g)"/>',
    wave: '<path d="M0 760 C180 640 360 880 540 760 S900 640 1080 760 V1350 H0Z" fill="#fafaf7" opacity=".85"/><path d="M0 900 C180 780 360 1020 540 900 S900 780 1080 900 V1350 H0Z" fill="#111110" opacity=".35"/>',
    arch: '<path d="M270 1000 V620 a270 270 0 0 1 540 0 V1000Z" fill="#fafaf7"/><rect x="270" y="1000" width="540" height="40" fill="#111110" opacity=".5"/>',
    sun: '<circle cx="540" cy="560" r="210" fill="#fafaf7"/><g stroke="#fafaf7" stroke-width="26" stroke-linecap="round"><path d="M540 250v-70M540 870v70M230 560h-70M850 560h70M320 340l-50-50M760 780l50 50M760 340l50-50M320 780l-50 50"/></g>',
    dots: '<g fill="#fafaf7"><circle cx="300" cy="420" r="90"/><circle cx="560" cy="620" r="130"/><circle cx="800" cy="440" r="70"/><circle cx="420" cy="900" r="70"/><circle cx="760" cy="920" r="100"/></g>',
    tri: '<path d="M540 330 L860 900 H220Z" fill="#fafaf7"/><path d="M540 520 L700 800 H380Z" fill="#111110" opacity=".45"/>',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/>${shapes[shape]}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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

  const sample = (n: number, name: string, kind: 'image' | 'video', a: string, b: string, shape: Parameters<typeof art>[2], hoursAgo: number, extra: Partial<MediaItem> = {}): MediaItem => {
    const src = art(a, b, shape);
    return {
      id: `m${n}`, path: `demo/${name}`, name, mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg', kind, sizeBytes: kind === 'video' ? 18_400_000 : 640_000,
      width: 1080, height: 1350, durationSeconds: kind === 'video' ? 24 : null, alt: '', createdAt: ago(hoursAgo * H), url: kind === 'video' ? null : src, thumbUrl: src, ...extra,
    };
  };
  const library: MediaItem[] = [
    sample(1, 'atelier-hiver.jpg', 'image', '#c6f432', '#6fae1f', 'moon', 3),
    sample(2, 'collection-automne.jpg', 'image', '#ffb86b', '#e1306c', 'sun', 9),
    sample(3, 'chene-massif.jpg', 'image', '#8fb8ff', '#3b5bdb', 'arch', 26),
    sample(4, 'finition-huile.jpg', 'image', '#f9d976', '#f39f86', 'wave', 30),
    sample(5, 'coulisses.mp4', 'video', '#2b2b2a', '#6b6b66', 'tri', 40, { alt: 'Visite de l’atelier' }),
    sample(6, 'tabouret-noyer.jpg', 'image', '#d4a5ff', '#7048e8', 'dots', 52),
    sample(7, 'livraison.mp4', 'video', '#ff9a9e', '#fad0c4', 'wave', 70, { sizeBytes: 31_000_000, durationSeconds: 41 }),
    sample(8, 'sur-mesure.jpg', 'image', '#a8e063', '#56ab2f', 'tri', 96),
  ];
  const attach = (...ids: string[]): PostItem['media'] =>
    ids.map((i) => library.find((m) => m.id === i)!).map((m) => ({ id: m.id, kind: m.kind, name: m.name, alt: m.alt, thumbUrl: m.thumbUrl, url: m.kind === 'image' ? m.url : null, durationSeconds: m.durationSeconds }));

  /** Médias joints aux publications d'exemple : numéro de publication → médias de la bibliothèque. */
  const ATTACHED: Record<number, string[]> = { 1: ['m2'], 2: ['m1', 'm3'], 3: ['m5'], 6: ['m4'] };
  const post = (n: number, networkId: NetworkId, accountName: string, content: string, hours: number, state: PostItem['state'], error: string | null = null, comment: Pick<PostItem, 'firstComment' | 'firstCommentState' | 'firstCommentError'> | null = null): PostItem => ({
    id: `p${n}`, groupId: `g${n}`, integrationId: integrations.find((i) => i.networkId === networkId && i.name === accountName)?.id ?? '', networkId, accountName, content,
    publishAt: new Date(T0 + hours * H).toISOString(), state, error, releaseUrl: state === 'published' ? 'https://example.com/post' : null,
    firstComment: comment?.firstComment ?? null, firstCommentState: comment?.firstCommentState ?? null, firstCommentError: comment?.firstCommentError ?? null,
    media: attach(...(ATTACHED[n] ?? [])),
  });

  return {
    conversations, integrations, media: library, agentThreads: [], videoJobs: [], generations: [], suggestions: [], invitations: [], orgName: DEMO_CONTEXT.org.name, seq,
    notifications: [
      { id: 'nt1', type: 'post_error', title: 'Canal à reconnecter', body: 'Le jeton d’accès a expiré : reconnectez le canal.', createdAt: ago(3 * H), read: false, href: '/app/calendrier' },
      { id: 'nt2', type: 'message_failed', title: 'Réponse non envoyée', body: 'La fenêtre de 24 h est dépassée : Meta n’autorise plus de réponse à cette conversation.', createdAt: ago(26 * H), read: true, href: '/app/inbox?c=c5' },
    ],
    members: [
      { userId: 'demo-user', name: 'Camille', role: 'admin', email: 'camille@maison-lune.example' },
      { userId: 'u2', name: 'Hugo', role: 'member', email: 'hugo@maison-lune.example' },
      { userId: 'u3', name: 'Nora', role: 'member', email: 'nora@maison-lune.example' },
      { userId: 'u4', name: 'Léo', role: 'viewer', email: 'leo@maison-lune.example' },
    ],
    posts: [
      post(1, 'facebook', 'Maison Lune', 'Nouvelle collection d’automne : les premières pièces arrivent demain 🍂', -20, 'published', null, { firstComment: 'Dites-nous en commentaire laquelle vous préférez 👇', firstCommentState: 'posted', firstCommentError: null }),
      post(2, 'facebook', 'Maison Lune', 'Atelier ouvert ce samedi, venez découvrir le savoir-faire.', 20, 'queued', null, { firstComment: 'Adresse et horaires : 12 rue des Tanneurs, 10 h – 17 h.', firstCommentState: 'pending', firstCommentError: null }),
      post(3, 'instagram', 'maison.lune', 'Coulisses de l’atelier — épisode 3', 28, 'queued'),
      post(4, 'youtube', 'Maison Lune TV', 'Finition à l’huile : le guide complet', 52, 'draft'),
      post(5, 'facebook', 'Maison Lune', 'Rappel : -10 % jusqu’à dimanche.', -3, 'error', 'Le jeton d’accès a expiré : reconnectez le canal.'),
      post(6, 'linkedin', 'Camille Moreau', 'Trois gestes de l’atelier qui font la durée d’un meuble.', -30, 'published', null, { firstComment: 'Le guide complet est sur notre site (lien en bio).', firstCommentState: 'failed', firstCommentError: 'LinkedIn a refusé le commentaire : accès insuffisant.' }),
      post(7, 'instagram', 'maison.lune', 'Un tabouret, trois essences de bois : laquelle choisiriez-vous ? 🪵', -70, 'published'),
      post(8, 'facebook', 'Maison Lune', 'Merci pour vos messages après le week-end portes ouvertes, on a adoré vous rencontrer.', -120, 'published'),
      post(9, 'youtube', 'Maison Lune TV', 'Visite de l’atelier : du chêne massif au meuble fini', -200, 'published'),
      post(10, 'instagram', 'maison.lune', 'Les finitions de la collection d’automne, en coulisses.', -330, 'published'),
    ],
    // La fiche des questions fréquentes n'est pas épinglée : l'IA ne la lit que si la question s'y rapporte (c'est ce que montre « Tester une question »).
    knowledge: knowledgeSeed(),
    knowledgeChunks: knowledgeSeed().flatMap((k) => chunkKnowledge(k.title, k.content).map((c, ord) => ({ itemId: k.id, ord, content: c.content, heading: c.heading }))),
  };
}

/** Les fiches de la démo, déjà indexées (par les mots). */
function knowledgeSeed(): KnowledgeItem[] {
  const items: Omit<KnowledgeItem, 'chunkCount' | 'indexedAt' | 'embeddedAt'>[] = [
    { id: 'k1', pinned: true, title: 'Ton de la marque', updatedAt: ago(30 * H), content: 'Maison Lune est un atelier de mobilier en bois massif, à Lyon. Nous tutoyons nos clients, avec un ton chaleureux et simple. Jamais de jargon ni de promesses exagérées. Nous parlons de matière, de geste et de durée.' },
    { id: 'k2', pinned: true, title: 'Offres en cours', updatedAt: ago(8 * H), content: 'Livraison offerte dès 60 € d’achat en France. -10 % sur la collection d’automne jusqu’à dimanche. Reprise gratuite de l’ancien meuble pour tout achat d’une table.' },
    { id: 'k3', pinned: false, title: 'Questions fréquentes', updatedAt: ago(2 * H), content: 'Délai de fabrication : 3 à 4 semaines. Livraison en France et en Belgique, 5 à 7 jours ouvrés après la fabrication. Finitions : huile naturelle ou cire. Garantie 5 ans. Atelier ouvert au public le samedi de 10 h à 17 h.' },
  ];
  return items.map((k) => ({ ...k, chunkCount: chunkKnowledge(k.title, k.content).length, indexedAt: ago(k.id === 'k3' ? 2 * H : 8 * H), embeddedAt: null }));
}

// ---------------------------------------------------------------- espaces de travail de la démo
// La démo a deux espaces : « Maison Lune » (le jeu d'exemple complet, où l'on est administrateur) et « Café du Port » (vide, où l'on est membre : on y voit
// ce que ne peut pas faire un membre). Ceux que l'on crée commencent vides. Chaque requête lit et écrit dans l'espace où elle s'exécute (AsyncLocalStorage),
// de sorte que les dépôts ci-dessous n'ont pas à savoir qu'il y en a plusieurs.

/** L'espace de travail où s'exécute la requête en cours. */
const inSpace = new AsyncLocalStorage<string>();
interface DemoSpace {
  id: string;
  role: OrgRole;
  /** Créé par la personne (compte dans son plafond de 10) ; l'espace d'exemple « Café du Port » lui a été ouvert par quelqu'un d'autre. */
  owned: boolean;
  /** Les données de l'espace ; le jeu d'exemple complet (espace principal) se construit à la première lecture. */
  store?: Store;
}

const g = globalThis as unknown as { __postbizDemo?: Store; __postbizDemoSpaces?: DemoSpace[]; __postbizDemoReceived?: DemoReceived[] };
const MAIN_ID = DEMO_CONTEXT.org.id;
const me = DEMO_CONTEXT.user;

function emptyStore(name: string, members: MemberItem[]): Store {
  // `Omit<…, 'seq'>` : une version plus ancienne de `Store` portait un compteur `seq` que plus rien ne lit.
  const empty: Omit<Store, 'seq'> = {
    notifications: [], conversations: [], integrations: [], members, posts: [], knowledge: [], knowledgeChunks: [], media: [], agentThreads: [], videoJobs: [],
    generations: [], suggestions: [], invitations: [], orgName: name,
  };
  return empty as Store;
}

const spaces = (): DemoSpace[] =>
  (g.__postbizDemoSpaces ??= [
    { id: MAIN_ID, role: 'admin', owned: true },
    {
      id: 'demo-org-2', role: 'member', owned: false,
      store: emptyStore('Café du Port', [
        { userId: me.id, name: me.name, role: 'member', email: me.email },
        { userId: 'u5', name: 'Hugo', role: 'admin', email: 'hugo@cafe-du-port.example' },
        { userId: 'u6', name: 'Inès', role: 'viewer', email: 'ines@cafe-du-port.example' },
      ]),
    },
  ]);
const storeOf = (s: DemoSpace): Store => (s.id === MAIN_ID ? (g.__postbizDemo ??= seed()) : s.store!);
const currentSpace = (): DemoSpace => spaces().find((s) => s.id === inSpace.getStore()) ?? spaces()[0]!;
const store = (): Store => storeOf(currentSpace());
const myRole = (): OrgRole => currentSpace().role;

/** Les espaces de la démo, du plus ancien au plus récent. */
export const demoWorkspaces = (): WorkspaceSummary[] => spaces().map((s) => ({ id: s.id, name: storeOf(s).orgName, role: s.role }));
/** Exécute `fn` dans l'espace désigné (pour les actions qui touchent à la démo sans passer par un dépôt). */
export const inDemoWorkspace = <T,>(orgId: string, fn: () => T): T => inSpace.run(orgId, fn);

/** Invitation reçue par la personne de la démo, avec le lien de la page d'invitation (jeton fixe : la démo n'a pas d'e-mail). */
export const DEMO_INVITATION_TOKEN = 'd3a0'.repeat(16);
interface DemoReceived { id: string; orgName: string; role: OrgRole; inviterName: string | null; token: string; expiresAt: string }
const received = (): DemoReceived[] =>
  (g.__postbizDemoReceived ??= [{ id: 'inv-demo-1', orgName: 'Studio Aube', role: 'member', inviterName: 'Léa', token: DEMO_INVITATION_TOKEN, expiresAt: ahead(6 * 24 * H) }]);


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
        id: id('p'), groupId, integrationId: integ.id, networkId: integ.networkId, accountName: integ.name, content: input.content.trim(),
        publishAt: input.publishAt, state: input.mode === 'schedule' ? 'queued' : 'draft', error: null, releaseUrl: null,
        firstComment: target.firstComment, firstCommentState: target.firstComment ? 'pending' : null, firstCommentError: null,
        media: input.media.flatMap((a) => {
          const m = s.media.find((x) => x.id === a.id);
          return m ? [{ id: m.id, kind: m.kind, name: m.name, alt: a.alt || m.alt, thumbUrl: m.thumbUrl, url: m.kind === 'image' ? m.url : null, durationSeconds: m.durationSeconds }] : [];
        }),
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

const refused = (key: FormError['key']): { ok: false; error: FormError } => ({ ok: false, error: { key } });
const FORBIDDEN = 'app.workspace.errors.forbidden' as const;

const workspace: WorkspaceRepository = {
  async integrations() { return store().integrations; },
  async members() {
    const isAdmin = myRole() === 'admin';
    return store().members.map((m) => ({ ...m, email: isAdmin ? (m.email ?? null) : null }));
  },
  async renameOrganization(name) { store().orgName = name; return { ok: true }; },
  async notifications() { return structuredClone(store().notifications); },
  async markNotificationsRead() { store().notifications.forEach((n) => { n.read = true; }); return { ok: true }; },

  async create(name, copyMembers) {
    if (!canCreateWorkspace(demoWorkspaces())) return refused('app.workspace.errors.notAdmin');
    if (spaces().filter((s) => s.owned).length >= MAX_WORKSPACES) return { ok: false, error: { key: 'app.workspace.errors.limit', params: { max: MAX_WORKSPACES } } };
    const source = store().members;
    const members: MemberItem[] = [{ userId: me.id, name: me.name, role: 'admin', email: me.email }];
    if (copyMembers && myRole() === 'admin') members.push(...source.filter((m) => m.userId !== me.id).map((m) => ({ ...m })));
    const space: DemoSpace = { id: id('demo-org'), role: 'admin', owned: true };
    space.store = emptyStore(name, members);
    spaces().push(space);
    return { ok: true, id: space.id };
  },
  async remove() {
    if (myRole() !== 'admin') return refused(FORBIDDEN);
    if (spaces().length <= 1) return refused('app.workspace.errors.lastWorkspace');
    const s = store();
    if (s.integrations.some((i) => i.status !== 'disabled')) return refused('app.workspace.errors.hasChannels');
    if (s.posts.some((p) => p.state === 'queued' || p.state === 'publishing')) return refused('app.workspace.errors.hasQueuedPosts');
    spaces().splice(spaces().indexOf(currentSpace()), 1);
    return { ok: true };
  },
  async setMemberRole(userId, role) {
    if (myRole() !== 'admin') return refused(FORBIDDEN);
    const members = store().members;
    const target = members.find((m) => m.userId === userId);
    if (!target || target.role === role) return { ok: true };
    if (target.role === 'admin' && adminCount(members) <= 1) return refused('app.workspace.errors.lastAdmin');
    target.role = role;
    if (userId === me.id) currentSpace().role = role;
    return { ok: true };
  },
  async removeMember(userId) {
    const self = userId === me.id;
    if (!self && myRole() !== 'admin') return refused(FORBIDDEN);
    const members = store().members;
    const target = members.find((m) => m.userId === userId);
    if (!target) return { ok: true };
    if (target.role === 'admin' && adminCount(members) <= 1) return refused('app.workspace.errors.lastAdmin');
    if (self && spaces().length <= 1) return refused('app.workspace.errors.lastWorkspace');
    members.splice(members.indexOf(target), 1);
    if (self) spaces().splice(spaces().indexOf(currentSpace()), 1);
    return { ok: true };
  },
  async invitations() {
    if (myRole() !== 'admin') return [];
    return store().invitations.map((i): InvitationItem => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt }));
  },
  async invite(email, role) {
    if (myRole() !== 'admin') return refused(FORBIDDEN);
    const s = store();
    if (s.members.some((m) => m.email?.toLowerCase() === email)) return refused('app.workspace.errors.alreadyMember');
    const existing = s.invitations.find((i) => i.email === email);
    if (!existing && s.invitations.length >= MAX_PENDING_INVITATIONS) return { ok: false, error: { key: 'app.workspace.errors.invitationLimit', params: { max: MAX_PENDING_INVITATIONS } } };
    const token = randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * H).toISOString();
    if (existing) Object.assign(existing, { role, token, createdAt, expiresAt });
    else s.invitations.push({ id: id('inv'), email, role, token, createdAt, expiresAt });
    return { ok: true, token };
  },
  async revokeInvitation(invitationId) {
    if (myRole() !== 'admin') return refused(FORBIDDEN);
    const list = store().invitations;
    const i = list.findIndex((x) => x.id === invitationId);
    if (i >= 0) list.splice(i, 1);
    return { ok: true };
  },
  async receivedInvitations() {
    return received().filter((i) => new Date(i.expiresAt).getTime() > Date.now()).map((i): ReceivedInvitation => ({ id: i.id, orgId: '', orgName: i.orgName, role: i.role, inviterName: i.inviterName, expiresAt: i.expiresAt }));
  },
  async previewInvitation(token) {
    const incoming = received().find((i) => i.token === token && new Date(i.expiresAt).getTime() > Date.now());
    if (incoming) return { orgId: '', orgName: incoming.orgName, role: incoming.role, inviterName: incoming.inviterName, expiresAt: incoming.expiresAt, alreadyMember: false };
    for (const space of spaces()) {
      const own = storeOf(space).invitations.find((i) => i.token === token && new Date(i.expiresAt).getTime() > Date.now());
      if (own) return { orgId: space.id, orgName: storeOf(space).orgName, role: own.role, inviterName: me.name, expiresAt: own.expiresAt, alreadyMember: true } satisfies InvitationPreview;
    }
    return null;
  },
  async acceptInvitation(token) {
    const incoming = received().find((i) => i.token === token && new Date(i.expiresAt).getTime() > Date.now());
    if (incoming) return joinDemoWorkspace(incoming);
    for (const space of spaces()) {
      const list = storeOf(space).invitations;
      const i = list.findIndex((x) => x.token === token && new Date(x.expiresAt).getTime() > Date.now());
      if (i >= 0) { list.splice(i, 1); return { ok: true, orgId: space.id }; } // déjà membre : l'invitation est consommée, le rôle ne change pas
    }
    return refused('app.workspace.errors.invitationInvalid');
  },
  async acceptReceivedInvitation(invitationId) {
    const incoming = received().find((i) => i.id === invitationId && new Date(i.expiresAt).getTime() > Date.now());
    return incoming ? joinDemoWorkspace(incoming) : refused('app.workspace.errors.invitationInvalid');
  },
  async declineReceivedInvitation(invitationId) {
    const list = received();
    const i = list.findIndex((x) => x.id === invitationId);
    if (i >= 0) list.splice(i, 1);
    return { ok: true };
  },
};

/** Accepter une invitation reçue : la personne rejoint l'espace (vide) avec le rôle proposé, et l'invitation disparaît. */
function joinDemoWorkspace(invitation: DemoReceived): { ok: true; orgId: string } {
  const space: DemoSpace = { id: id('demo-org'), role: invitation.role, owned: false };
  space.store = emptyStore(invitation.orgName, [
    { userId: me.id, name: me.name, role: invitation.role, email: me.email },
    { userId: id('u'), name: invitation.inviterName ?? 'Administrateur', role: 'admin', email: null },
  ]);
  spaces().push(space);
  const list = received();
  list.splice(list.indexOf(invitation), 1);
  return { ok: true, orgId: space.id };
}

/** Mode démo : « connecte » un canal fictif pour pouvoir parcourir l'onboarding sans OAuth. */
export function demoConnectChannel(networkId: NetworkId, name: string): Result {
  const s = store();
  if (s.integrations.some((i) => i.networkId === networkId)) return { ok: true };
  s.integrations.push({ id: id('i'), networkId, name, username: null, pictureUrl: null, status: 'active' });
  return { ok: true };
}

const media: MediaRepository = {
  async list({ page = 1, pageSize = 40, search } = {}) {
    const term = search?.trim().toLowerCase();
    const all = [...store().media]
      .filter((m) => !term || m.name.toLowerCase().includes(term))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const from = (Math.max(1, page) - 1) * pageSize;
    return { items: all.slice(from, from + pageSize).map((m) => ({ ...m })), total: all.length };
  },
  async byIds(ids) {
    const byId = new Map(store().media.map((m) => [m.id, m]));
    return ids.map((i) => byId.get(i)).filter((m): m is MediaItem => !!m).map((m) => ({ ...m }));
  },
  async remove(ids) {
    const s = store();
    const used = (mid: string) => s.posts.filter((p) => (p.state === 'draft' || p.state === 'queued') && p.media.some((m) => m.id === mid)).length;
    const blocked = ids.filter((i) => used(i) > 0).map((i) => ({ id: i, posts: used(i) }));
    const removed = ids.filter((i) => used(i) === 0 && s.media.some((m) => m.id === i));
    s.media = s.media.filter((m) => !removed.includes(m.id));
    return { removed, blocked };
  },
};

/** Les mots d'un texte, comme la base les compte (minuscules, lettres et chiffres). */
const wordsOf = (text: string) => [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
/** Deux mots se correspondent s'ils sont égaux ou, à partir de cinq lettres, s'ils commencent pareil (« livrez » et « livraison ») : la démo n'a ni vecteurs ni radicaux, ce rapprochement lui en tient lieu. */
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4));

const knowledge: KnowledgeRepository = {
  async list() {
    return [...store().knowledge].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((k) => ({ ...k }));
  },
  async create(input: KnowledgeInput) {
    const item: KnowledgeItem = { id: id('k'), title: input.title.trim(), content: input.content.trim(), updatedAt: new Date().toISOString(), pinned: true, chunkCount: 0, indexedAt: null, embeddedAt: null };
    store().knowledge.push(item);
    return { ok: true, id: item.id };
  },
  async update(itemId, input) {
    const s = store();
    const item = s.knowledge.find((k) => k.id === itemId);
    if (!item) return { ok: false, error: { key: 'app.knowledge.errSave' } };
    const changed = item.title !== input.title.trim() || item.content !== input.content.trim();
    Object.assign(item, { title: input.title.trim(), content: input.content.trim(), updatedAt: new Date().toISOString() });
    // Comme la base : un titre ou un contenu modifié supprime les passages, la fiche est à réindexer.
    if (changed) {
      s.knowledgeChunks = s.knowledgeChunks.filter((c) => c.itemId !== itemId);
      Object.assign(item, { chunkCount: 0, indexedAt: null, embeddedAt: null });
    }
    return { ok: true };
  },
  async setPinned(itemId, pinned) {
    const item = store().knowledge.find((k) => k.id === itemId);
    if (!item) return { ok: false, error: { key: 'app.knowledge.errSave' } };
    item.pinned = pinned;
    return { ok: true };
  },
  async remove(itemId) {
    const s = store();
    s.knowledge = s.knowledge.filter((k) => k.id !== itemId);
    s.knowledgeChunks = s.knowledgeChunks.filter((c) => c.itemId !== itemId);
    return { ok: true };
  },
  async replaceChunks(itemId, chunks) {
    const s = store();
    const item = s.knowledge.find((k) => k.id === itemId);
    if (!item) return { ok: false, error: { key: 'app.knowledge.errIndex' } };
    s.knowledgeChunks = s.knowledgeChunks.filter((c) => c.itemId !== itemId);
    chunks.forEach((c, ord) => s.knowledgeChunks.push({ itemId, ord, content: c.content, heading: c.meta.heading ?? null }));
    Object.assign(item, { chunkCount: chunks.length, indexedAt: new Date().toISOString(), embeddedAt: chunks.length > 0 && chunks.every((c) => c.embedding) ? new Date().toISOString() : null });
    return { ok: true };
  },
  /** Recherche par les mots (la démo n'a pas de vecteurs) : les passages qui contiennent des mots de la question, les plus fournis d'abord. */
  async search({ terms, limit, perItem, exclude }) {
    const s = store();
    const title = new Map(s.knowledge.map((k) => [k.id, k.title]));
    const scored = s.knowledgeChunks
      .filter((c) => !exclude.includes(c.itemId) && title.has(c.itemId))
      .map((c) => ({ c, hits: terms.filter((t) => wordsOf(c.content).some((w) => sameWord(t, w))).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.c.ord - b.c.ord);
    const taken = new Map<string, number>();
    return scored
      .filter(({ c }) => {
        const n = (taken.get(c.itemId) ?? 0) + 1;
        taken.set(c.itemId, n);
        return n <= perItem;
      })
      .slice(0, limit)
      .map(({ c, hits }) => ({ chunkId: `${c.itemId}:${c.ord}`, itemId: c.itemId, title: title.get(c.itemId)!, content: c.content, heading: c.heading, similarity: 0, termHits: hits, score: hits }));
  },
};

/** Conversations de l'agent du mode démo : en mémoire, comme le reste ; une seule personne (la démo) les voit. */
const agent: AgentRepository = {
  async threads() {
    return [...(store().agentThreads ??= [])].map((t) => ({ ...t.thread })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async thread(threadId) {
    const t = (store().agentThreads ??= []).find((x) => x.thread.id === threadId);
    return t ? structuredClone(t) : null;
  },
  async saveExchange({ threadId, title, user, assistant }) {
    const threads = (store().agentThreads ??= []);
    let entry = threadId ? threads.find((x) => x.thread.id === threadId) : undefined;
    if (threadId && !entry) return null;
    const now = Date.now();
    if (!entry) {
      entry = { thread: { id: id('a'), title, updatedAt: new Date(now).toISOString() }, messages: [] };
      threads.push(entry);
    }
    const userMessage: AgentMessage = { id: id('am'), role: 'user', text: user.text, proposals: [], mediaIds: user.mediaIds, jobIds: [], createdAt: new Date(now).toISOString() };
    const assistantMessage: AgentMessage = { id: id('am'), role: 'assistant', text: assistant.text, proposals: structuredClone(assistant.proposals), mediaIds: assistant.mediaIds, jobIds: assistant.jobIds, createdAt: new Date(now + 1).toISOString() };
    entry.messages.push(userMessage, assistantMessage);
    entry.thread.updatedAt = assistantMessage.createdAt;
    return structuredClone({ thread: entry.thread, user: userMessage, assistant: assistantMessage });
  },
  async updateProposals(messageId, updates) {
    const message = (store().agentThreads ??= []).flatMap((t) => t.messages).find((m) => m.id === messageId);
    if (!message) return { ok: false, error: { key: 'app.agent.errors.failed' } };
    for (const u of updates) {
      const proposal = message.proposals.find((p) => p.id === u.id);
      if (proposal) Object.assign(proposal, { status: u.status, text: u.text, firstComment: u.firstComment, mediaIds: u.mediaIds, publishAt: u.publishAt });
    }
    return { ok: true };
  },
  async removeThread(threadId) {
    const s = store();
    s.agentThreads = (s.agentThreads ?? []).filter((t) => t.thread.id !== threadId);
    return { ok: true };
  },
};

/** Générations de la démo : la médiathèque en mémoire reçoit un visuel dessiné (le même que les médias d'exemple) ; aucun fichier n'est envoyé nulle part. */
const generation: GenerationRepository = {
  async reserveText() {
    return true;
  },
  async reserve(kind, limit) {
    const s = store();
    const since = Date.now() - 86_400_000;
    if (s.generations.filter((g) => g.kind === kind && g.at > since).length >= limit) return false;
    s.generations.push({ kind, at: Date.now() });
    return true;
  },
  async createMedia(input) {
    const s = store();
    const shapes = ['moon', 'wave', 'arch', 'sun', 'dots', 'tri'] as const;
    const palette = [['#c6f432', '#6fae1f'], ['#ffb86b', '#e1306c'], ['#8fb8ff', '#3b5bdb'], ['#d4a5ff', '#7048e8'], ['#f9d976', '#f39f86']] as const;
    const n = [...input.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const [a, b] = palette[n % palette.length]!;
    const src = art(a, b, shapes[n % shapes.length]!);
    const kind = input.mimeType.startsWith('video/') ? 'video' : 'image';
    const item: MediaItem = {
      id: id('m'), path: `demo/${input.name}`, name: input.name, mimeType: input.mimeType, kind, sizeBytes: input.bytes.byteLength, width: input.width, height: input.height,
      durationSeconds: input.durationSeconds, alt: input.alt, createdAt: new Date().toISOString(), url: kind === 'image' ? src : null, thumbUrl: src,
    };
    s.media.unshift(item);
    return { ...item };
  },
  async activeJobs() {
    return store().videoJobs.filter((j) => j.status === 'pending').length;
  },
  async createJob(input) {
    const job: VideoJobRecord = { id: id('vj'), status: 'pending', orientation: input.orientation, prompt: input.prompt, mediaId: null, error: null, createdAt: new Date().toISOString(), providerTaskId: input.providerTaskId, claimedAt: null };
    store().videoJobs.push(job);
    return { ...job };
  },
  async jobs(ids) {
    const byId = new Map(store().videoJobs.map((j) => [j.id, j]));
    return ids.map((i) => byId.get(i)).filter((j): j is VideoJobRecord => !!j).map((j) => ({ ...j }));
  },
  async claimJob(jobId) {
    const job = store().videoJobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'pending' || job.claimedAt) return false;
    job.claimedAt = new Date().toISOString();
    return true;
  },
  async settleJob(jobId, result) {
    const job = store().videoJobs.find((j) => j.id === jobId);
    if (!job) return false;
    job.claimedAt = null;
    job.status = result.status;
    if (result.status === 'completed') Object.assign(job, { mediaId: result.mediaId, error: null });
    if (result.status === 'failed') job.error = result.error;
    return true;
  },
};

/** Suggestions de réponse de la démo : gardées en mémoire, comme le reste. */
const suggestions: SuggestionRepository = {
  async countToday() {
    const since = Date.now() - 86_400_000;
    return store().suggestions.filter((x) => x.at > since).length;
  },
  async log(i) {
    const entry = { id: id('sg'), at: Date.now(), reply: i.reply, outcome: null as 'sent' | 'edited' | null };
    store().suggestions.push(entry);
    return entry.id;
  },
  async reply(suggestionId) {
    return store().suggestions.find((x) => x.id === suggestionId)?.reply ?? null;
  },
  async settle(suggestionId, outcome) {
    const entry = store().suggestions.find((x) => x.id === suggestionId);
    if (entry && entry.outcome === null) entry.outcome = outcome;
  },
};

/**
 * Analyses de la démo : les séries sont fabriquées (voir lib/analytics/demo.ts), la file de publication est celle des publications d'exemple,
 * pour que ses chiffres collent au calendrier.
 */
const analytics: AnalyticsRepository = {
  async load(window, now = new Date()) {
    const s = store();
    return {
      rows: demoDailyRows(s.integrations, window),
      queue: queueCounts(s.posts.map((p) => ({ integrationId: p.integrationId, state: p.state, at: p.publishAt })), now),
      recent: s.posts
        .filter((p) => p.state === 'published' && p.publishAt)
        .sort((a, b) => b.publishAt!.localeCompare(a.publishAt!))
        .map((p) => ({ id: p.id, integrationId: p.integrationId, content: p.content, at: p.publishAt!, url: p.releaseUrl })),
      collection: [],
      truncated: false,
      error: false,
    };
  },
};

/** Les dépôts de la démo pour l'espace principal (utilisés tels quels par les tests). */
export const demoRepositories: Repositories = { inbox, posts, workspace, media, knowledge, analytics, agent, generation, suggestions };

/** Les mêmes dépôts, liés à un espace : chaque appel s'exécute dans cet espace, quel que soit l'espace des requêtes concurrentes. */
function bound<R extends object>(repo: R, orgId: string): R {
  return Object.fromEntries(
    Object.entries(repo).map(([k, v]) => [k, typeof v === 'function' ? (...args: unknown[]) => inSpace.run(orgId, () => (v as (...a: unknown[]) => unknown).apply(repo, args)) : v]),
  ) as R;
}
export const demoRepositoriesFor = (orgId: string): Repositories => ({
  inbox: bound(inbox, orgId), posts: bound(posts, orgId), workspace: bound(workspace, orgId), media: bound(media, orgId), knowledge: bound(knowledge, orgId),
  analytics: bound(analytics, orgId), agent: bound(agent, orgId), generation: bound(generation, orgId), suggestions: bound(suggestions, orgId),
});
