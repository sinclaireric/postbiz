/** Phase commerciale d'une organisation (voir `subscription_phase` en base). */
export const PHASES = ['trialing', 'paying', 'trial_expired', 'past_due', 'canceled', 'none'] as const;
export type Phase = (typeof PHASES)[number];

/** Organisations d'une offre, d'un rythme de facturation et d'une phase. */
export interface PlanCount {
  plan: string;
  interval: 'monthly' | 'yearly';
  phase: Phase;
  /** `none`, `stripe`, `pawapay` ou `gift` (abonnement offert : jamais compté dans le MRR). */
  provider: string;
  count: number;
  /** Somme, en dollars, de ce que rapportent ces abonnements par mois (prix réellement payés, remises comprises). */
  mrrUsd: number;
}

export interface AdminOverview {
  users: { total: number; new7d: number; new30d: number; active7d: number; unconfirmed: number };
  orgs: { total: number; withChannel: number; withPublished: number };
  phases: Record<Phase, number>;
  trialsEnding3d: number;
  cancelAtPeriodEnd: number;
  /** Organisations avec un abonnement offert en cours. */
  gifts: number;
  byPlan: PlanCount[];
  channels: { total: number; needsReconnect: number; byProvider: Record<string, number> };
  posts: { created7d: number; byState: Record<string, number> };
  /** Inscriptions des 30 derniers jours, du plus ancien au plus récent. */
  signups: { day: string; count: number }[];
}

export interface SubscriptionInfo {
  plan: string | null;
  interval: 'monthly' | 'yearly' | null;
  phase: Phase;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AdminUserRow extends SubscriptionInfo {
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  orgId: string | null;
  orgName: string | null;
  role: 'admin' | 'member' | 'viewer' | null;
  orgsCount: number;
  channelsCount: number;
  postsCount: number;
  suspended: boolean;
}

export interface AdminOrgRow extends SubscriptionInfo {
  orgId: string;
  name: string;
  createdAt: string;
  ownerEmail: string | null;
  membersCount: number;
  channelsCount: number;
  postsCount: number;
}

export interface AdminPage<T> {
  rows: T[];
  /** Nombre de résultats avant pagination. */
  total: number;
}

export interface ListQuery {
  search: string;
  phase: Phase | null;
  page: number;
}

export type ChannelStatus = 'active' | 'refresh_needed' | 'disabled';

export interface AdminChannel {
  id: string;
  provider: string;
  name: string;
  username: string | null;
  status: ChannelStatus;
  createdAt: string;
  tokenExpiresAt: string | null;
}

export interface AdminSubscription extends SubscriptionInfo {
  status: string;
  canceledAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  /** `none`, `stripe`, `pawapay` ou `gift`. */
  provider: string;
  currency: string | null;
  country: string | null;
  monthlyUsd: number | null;
  graceEndsAt: string | null;
  giftNote: string | null;
  /** Offre réellement applicable aujourd'hui (peut différer de `plan` : essai ou période terminés). */
  effectivePlan: string | null;
}

/** Une organisation d'un utilisateur, avec ce qu'elle contient. Jamais de texte de publication ni de jeton : seulement des chiffres. */
export interface AdminUserOrg {
  orgId: string;
  name: string;
  createdAt: string;
  role: 'admin' | 'member' | 'viewer';
  membersCount: number;
  /** Absent pour une organisation créée avant la mise en place des essais. */
  subscription: AdminSubscription | null;
  channels: AdminChannel[];
  posts: { byState: Record<string, number>; lastPublishedAt: string | null; lastCreatedAt: string | null };
}

export interface AdminUserDetail {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  provider: string;
  orgs: AdminUserOrg[];
}

/** Suspension d'un compte, et si ce compte est protégé (administrateur de la plateforme). */
export interface AdminUserStatus {
  suspension: { at: string; reason: string | null; byEmail: string | null } | null;
  isPlatformAdmin: boolean;
}

/** Résultat d'une action de suspension, porté par `?ok=` au retour sur la fiche. */
export const FLASHES = ['suspended', 'restored', 'demo', 'self', 'protected', 'error', 'gifted', 'giftRevoked', 'giftPaid', 'giftInvalid'] as const;
export type Flash = (typeof FLASHES)[number];

/** Un paiement de la plateforme, pour la page Facturation du propriétaire. */
export interface AdminPayment {
  id: string;
  orgId: string;
  orgName: string;
  ownerEmail: string | null;
  provider: 'stripe' | 'pawapay' | 'gift';
  plan: string;
  months: number;
  amount: number;
  currency: string;
  usdAmount: number;
  country: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
  failureReason: string | null;
  createdAt: string;
  periodEnd: string | null;
}
