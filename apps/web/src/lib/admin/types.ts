/** Phase commerciale d'une organisation (voir `subscription_phase` en base). */
export const PHASES = ['trialing', 'paying', 'trial_expired', 'past_due', 'canceled', 'none'] as const;
export type Phase = (typeof PHASES)[number];

/** Organisations d'une offre, d'un rythme de facturation et d'une phase. */
export interface PlanCount {
  plan: string;
  interval: 'monthly' | 'yearly';
  phase: Phase;
  count: number;
}

export interface AdminOverview {
  users: { total: number; new7d: number; new30d: number; active7d: number; unconfirmed: number };
  orgs: { total: number; withChannel: number; withPublished: number };
  phases: Record<Phase, number>;
  trialsEnding3d: number;
  cancelAtPeriodEnd: number;
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
