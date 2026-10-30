import type { AgentMessage, AgentProposal, AgentProposalStatus, AgentThread, AgentVideoJob, VideoOrientation } from '@/lib/agent/types';
import type { KnowledgeChunkInput, KnowledgeHit, KnowledgeSearchQuery } from '@/lib/kb/types';
import type { AnalyticsRepository } from '@/lib/analytics/types';
import type { FormError } from '@/lib/form-error';
import type { MediaKind } from '@/lib/media/rules';
import type { NetworkId } from '@/lib/inbox/types';
import type { InboxRepository } from '@/lib/inbox/types';

export type OrgRole = 'admin' | 'member' | 'viewer';

/** Un espace de travail (une organisation) dont la personne est membre, avec son rôle dans cet espace. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: OrgRole;
}

export interface AppContext {
  mode: 'demo' | 'supabase';
  user: { id: string; email: string; name: string };
  /** L'espace de travail courant : celui que la personne a choisi, toujours vérifié contre ses appartenances. */
  org: { id: string; name: string; role: OrgRole };
  /** Tous ses espaces de travail, du plus ancien au plus récent (le courant en fait partie). */
  workspaces: WorkspaceSummary[];
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
  /** Adresse e-mail : donnée aux administrateurs de l'espace seulement. */
  email?: string | null;
}

/** Invitation en attente dans l'espace courant (vue des administrateurs). Le lien n'est jamais relisible : seul son créateur le voit, une fois. */
export interface InvitationItem {
  id: string;
  email: string;
  role: OrgRole;
  createdAt: string;
  expiresAt: string;
}

/** Invitation reçue par la personne connectée (l'adresse de son compte, confirmée, figure sur l'invitation). */
export interface ReceivedInvitation {
  id: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  inviterName: string | null;
  expiresAt: string;
}

/** Ce que montre la page d'un lien d'invitation. */
export interface InvitationPreview {
  orgId: string;
  orgName: string;
  role: OrgRole;
  inviterName: string | null;
  expiresAt: string;
  alreadyMember: boolean;
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

export type WorkspaceCreated = { ok: true; id: string } | { ok: false; error: FormError };
/** Le jeton d'un lien d'invitation, rendu une seule fois à l'administrateur qui invite. */
export type InviteResult = { ok: true; token: string } | { ok: false; error: FormError };
export type JoinResult = { ok: true; orgId: string } | { ok: false; error: FormError };

export interface WorkspaceRepository {
  integrations(): Promise<IntegrationItem[]>;
  members(): Promise<MemberItem[]>;
  renameOrganization(name: string): Promise<Result>;
  notifications(): Promise<NotificationItem[]>;
  markNotificationsRead(): Promise<Result>;

  /** Crée un espace de travail dont la personne est administratrice ; `copyMembers` y reprend les membres de l'espace courant (avec leur rôle). */
  create(name: string, copyMembers: boolean): Promise<WorkspaceCreated>;
  /** Supprime l'espace courant (administrateurs ; refusé s'il reste des canaux ou des publications en file, ou si c'est le dernier espace de la personne). */
  remove(): Promise<Result>;
  setMemberRole(userId: string, role: OrgRole): Promise<Result>;
  /** Retire un membre de l'espace courant ; avec son propre identifiant, la personne quitte l'espace. Jamais le dernier administrateur. */
  removeMember(userId: string): Promise<Result>;
  invitations(): Promise<InvitationItem[]>;
  invite(email: string, role: OrgRole): Promise<InviteResult>;
  revokeInvitation(id: string): Promise<Result>;
  receivedInvitations(): Promise<ReceivedInvitation[]>;
  previewInvitation(token: string): Promise<InvitationPreview | null>;
  acceptInvitation(token: string): Promise<JoinResult>;
  acceptReceivedInvitation(id: string): Promise<JoinResult>;
  declineReceivedInvitation(id: string): Promise<Result>;
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
  /** Épinglée : envoyée en entier à l'IA à chaque demande (voix de la marque, règles). Sinon, consultée seulement par la recherche. */
  pinned: boolean;
  /** Nombre de passages de la recherche. */
  chunkCount: number;
  /** Date de la dernière indexation ; null : jamais indexée, ou modifiée depuis (à réindexer). */
  indexedAt: string | null;
  /** Date à laquelle tous ses passages avaient leur vecteur ; null : cherchable par les mots seulement. */
  embeddedAt: string | null;
}

/** Ce que le composeur sait d'une fiche : de quoi les compter, pas leur contenu (qui peut peser plusieurs centaines de Ko). */
export type KnowledgeBrief = Pick<KnowledgeItem, 'id' | 'title' | 'pinned'>;

export interface KnowledgeInput {
  title: string;
  content: string;
}

/** Fiches que l'IA lit pour écrire dans la voix de l'organisation et répondre juste (ton, offres, produits, questions fréquentes). */
export interface KnowledgeRepository {
  list(): Promise<KnowledgeItem[]>;
  /** Crée une fiche ; `id` est celui de la nouvelle fiche, pour l'indexer ensuite. */
  create(input: KnowledgeInput): Promise<Result & { id?: string }>;
  /** Modifier le titre ou le contenu supprime les passages de la fiche : elle est à réindexer. */
  update(id: string, input: KnowledgeInput): Promise<Result>;
  setPinned(id: string, pinned: boolean): Promise<Result>;
  remove(id: string): Promise<Result>;
  /** Remplace les passages d'une fiche (l'index de la recherche). */
  replaceChunks(itemId: string, chunks: KnowledgeChunkInput[]): Promise<Result>;
  /** Cherche des passages dans la base de l'organisation, par le sens (si `embedding`) et par les mots. */
  search(query: KnowledgeSearchQuery): Promise<KnowledgeHit[]>;
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
  /** `mediaIds` : images générées dans ce message ; `jobIds` : vidéos lancées. */
  assistant: { text: string; proposals: AgentProposal[]; mediaIds: string[]; jobIds: string[] };
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

/** Un fichier produit par l'agent, à ranger dans la médiathèque de l'organisation. */
export interface GeneratedMediaInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Texte alternatif proposé par l'agent (vide : aucun). */
  alt: string;
}

/** Une tâche de génération vidéo telle que la garde la base : l'état public, plus ce dont l'application a besoin pour la faire avancer. */
export interface VideoJobRecord extends AgentVideoJob {
  /** Identifiant de la tâche chez le fournisseur. Ne quitte jamais le serveur. */
  providerTaskId: string;
  /** Une requête est en train d'enregistrer la vidéo terminée (date de sa prise en charge), sinon null. */
  claimedAt: string | null;
}

/** Génération d'images et de vidéos par l'agent : plafonds, médiathèque et tâches. Toutes les opérations sont celles de l'utilisateur connecté (RLS). */
export interface GenerationRepository {
  /**
   * Réserve une génération pour l'organisation, de façon atomique : « monthly » quand l'offre n'en permet plus ce mois-ci, faux quand le plafond
   * anti-abus de `limit` sur 24 h est atteint (ou l'accès refusé), vrai sinon.
   */
  reserve(kind: 'image' | 'video', limit: number): Promise<boolean | 'monthly'>;
  /**
   * Réserve une action d'IA texte (assistant du composeur, suggestion de réponse, agent) sous la limite mensuelle de l'offre : faux quand elle est atteinte.
   * Toujours vrai sans facturation activée (la base journalise quand même l'usage).
   */
  reserveText(feature: 'assistant' | 'suggestion' | 'agent'): Promise<boolean>;
  /** Range un fichier généré dans la médiathèque ; null si l'envoi ou l'enregistrement a échoué (rien n'est gardé). */
  createMedia(input: GeneratedMediaInput): Promise<MediaItem | null>;
  /** Nombre de vidéos de l'utilisateur encore en cours. */
  activeJobs(): Promise<number>;
  createJob(input: { prompt: string; orientation: VideoOrientation; providerTaskId: string; referenceMediaIds: string[] }): Promise<VideoJobRecord | null>;
  /** Les tâches demandées (les siennes seulement), dans l'ordre des identifiants ; les autres sont ignorées. */
  jobs(ids: string[]): Promise<VideoJobRecord[]>;
  /** Prend en charge l'enregistrement d'une vidéo terminée : vrai pour une seule requête. Une prise en charge plus ancienne que `staleBefore` (ISO) est reprise. */
  claimJob(id: string, staleBefore: string): Promise<boolean>;
  /** Termine ou relâche une tâche (`pending` : la prise en charge est abandonnée, une prochaine requête réessaiera). */
  settleJob(id: string, result: { status: 'pending' } | { status: 'completed'; mediaId: string } | { status: 'failed'; error: string }): Promise<boolean>;
}

/** Les réponses suggérées par l'IA dans l'inbox, gardées pour mesurer ce qu'on en fait et plafonner leur nombre par jour. */
export interface SuggestionRepository {
  /** Suggestions préparées par l'organisation sur les dernières 24 heures. */
  countToday(): Promise<number>;
  /** Garde une suggestion ; rend son identifiant, ou null si elle n'a pas pu l'être. */
  log(input: { conversationId: string; reply: string; grounded: boolean; needsHuman: boolean; sources: string[]; model: string; inputTokens: number | null; outputTokens: number | null }): Promise<string | null>;
  /** Le texte suggéré (pour savoir si la réponse envoyée a été modifiée). */
  reply(id: string): Promise<string | null>;
  /** Marque ce que l'utilisateur en a fait, une seule fois. */
  settle(id: string, outcome: 'sent' | 'edited'): Promise<void>;
}

export interface Repositories {
  agent: AgentRepository;
  generation: GenerationRepository;
  suggestions: SuggestionRepository;
  analytics: AnalyticsRepository;
  media: MediaRepository;
  knowledge: KnowledgeRepository;
  inbox: InboxRepository;
  posts: PostsRepository;
  workspace: WorkspaceRepository;
}


