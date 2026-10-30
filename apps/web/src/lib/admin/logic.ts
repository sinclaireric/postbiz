import { USD_MONTHLY, isPaidPlanId } from '@/lib/billing/plans';
import { FLASHES, PHASES, type AdminPayment, type AdminChannel, type AdminOrgRow, type AdminOverview, type AdminSubscription, type AdminUserDetail, type AdminUserOrg, type AdminUserRow, type AdminUserStatus, type ChannelStatus, type Flash, type ListQuery, type Phase, type PlanCount } from './types';

export const PAGE_SIZE = 25;
const DAY = 86_400_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const counts = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));
export const asPhase = (v: unknown): Phase => ((PHASES as readonly string[]).includes(v as string) ? (v as Phase) : 'none');

/** Réponse de `admin_overview()` (jsonb en snake_case) → objet typé ; une clé absente vaut zéro plutôt que de casser la page. */
export function parseOverview(raw: unknown): AdminOverview {
  const o = obj(raw);
  const users = obj(o.users);
  const orgs = obj(o.orgs);
  const channels = obj(o.channels);
  const posts = obj(o.posts);
  const phases = counts(o.phases);
  return {
    users: { total: num(users.total), new7d: num(users.new_7d), new30d: num(users.new_30d), active7d: num(users.active_7d), unconfirmed: num(users.unconfirmed) },
    orgs: { total: num(orgs.total), withChannel: num(orgs.with_channel), withPublished: num(orgs.with_published) },
    phases: Object.fromEntries(PHASES.map((p) => [p, phases[p] ?? 0])) as Record<Phase, number>,
    trialsEnding3d: num(o.trials_ending_3d),
    cancelAtPeriodEnd: num(o.cancel_at_period_end),
    gifts: num(o.gifts),
    byPlan: (Array.isArray(o.by_plan) ? o.by_plan : []).map((r): PlanCount => {
      const row = obj(r);
      return { plan: str(row.plan) ?? '', interval: row.interval === 'yearly' ? 'yearly' : 'monthly', phase: asPhase(row.phase), provider: str(row.provider) ?? 'none', count: num(row.count), mrrUsd: num(row.mrr_usd) };
    }),
    channels: { total: num(channels.total), needsReconnect: num(channels.needs_reconnect), byProvider: counts(channels.by_provider) },
    posts: { created7d: num(posts.created_7d), byState: counts(posts.by_state) },
    signups: (Array.isArray(o.signups) ? o.signups : []).map((r) => ({ day: str(obj(r).day) ?? '', count: num(obj(r).count) })),
  };
}

const sub = (r: Json) => ({
  plan: str(r.plan),
  interval: r.billing_interval === 'yearly' ? ('yearly' as const) : r.billing_interval === 'monthly' ? ('monthly' as const) : null,
  phase: asPhase(r.phase),
  trialEndsAt: str(r.trial_ends_at),
  currentPeriodEnd: str(r.current_period_end),
  cancelAtPeriodEnd: r.cancel_at_period_end === true,
});

/** Ligne de `admin_users()` → utilisateur. */
export function parseUserRow(raw: unknown): AdminUserRow {
  const r = obj(raw);
  const role = str(r.role);
  return {
    ...sub(r),
    userId: str(r.user_id) ?? '',
    email: str(r.email) ?? '',
    name: str(r.display_name),
    createdAt: str(r.created_at) ?? '',
    lastSignInAt: str(r.last_sign_in_at),
    emailConfirmed: r.email_confirmed === true,
    orgId: str(r.org_id),
    orgName: str(r.org_name),
    role: role === 'admin' || role === 'member' || role === 'viewer' ? role : null,
    orgsCount: num(r.orgs_count),
    channelsCount: num(r.channels_count),
    postsCount: num(r.posts_count),
    suspended: r.suspended === true,
  };
}

/** Ligne de `admin_organizations()` → organisation. */
export function parseOrgRow(raw: unknown): AdminOrgRow {
  const r = obj(raw);
  return {
    ...sub(r),
    orgId: str(r.org_id) ?? '',
    name: str(r.org_name) ?? '',
    createdAt: str(r.created_at) ?? '',
    ownerEmail: str(r.owner_email),
    membersCount: num(r.members_count),
    channelsCount: num(r.channels_count),
    postsCount: num(r.posts_count),
  };
}

const ROLES = ['admin', 'member', 'viewer'] as const;
const CHANNEL_STATUSES: readonly string[] = ['active', 'refresh_needed', 'disabled'];

function parseChannel(raw: unknown): AdminChannel {
  const r = obj(raw);
  const status = str(r.status) ?? '';
  return {
    id: str(r.id) ?? '',
    provider: str(r.provider) ?? '',
    name: str(r.name) ?? '',
    username: str(r.username),
    status: (CHANNEL_STATUSES.includes(status) ? status : 'active') as ChannelStatus,
    createdAt: str(r.created_at) ?? '',
    tokenExpiresAt: str(r.token_expires_at),
  };
}

function parseSubscription(raw: unknown): AdminSubscription | null {
  const r = obj(raw);
  if (Object.keys(r).length === 0) return null;
  return {
    ...sub(r),
    status: str(r.status) ?? '',
    canceledAt: str(r.canceled_at),
    stripeCustomerId: str(r.stripe_customer_id),
    stripeSubscriptionId: str(r.stripe_subscription_id),
    provider: str(r.provider) ?? 'none',
    currency: str(r.currency),
    country: str(r.country),
    monthlyUsd: r.monthly_usd === null || r.monthly_usd === undefined ? null : num(r.monthly_usd),
    graceEndsAt: str(r.grace_ends_at),
    giftNote: str(r.gift_note),
    effectivePlan: str(r.effective_plan),
    createdAt: str(r.created_at) ?? '',
  };
}

function parseUserOrg(raw: unknown): AdminUserOrg {
  const r = obj(raw);
  const posts = obj(r.posts);
  const role = str(r.role);
  return {
    orgId: str(r.org_id) ?? '',
    name: str(r.name) ?? '',
    createdAt: str(r.created_at) ?? '',
    role: (ROLES as readonly string[]).includes(role ?? '') ? (role as (typeof ROLES)[number]) : 'member',
    membersCount: num(r.members_count),
    subscription: parseSubscription(r.subscription),
    channels: (Array.isArray(r.channels) ? r.channels : []).map(parseChannel),
    posts: { byState: counts(posts.by_state), lastPublishedAt: str(posts.last_published_at), lastCreatedAt: str(posts.last_created_at) },
  };
}

/** Réponse de `admin_user_detail()` ; `null` quand l'utilisateur n'existe pas. */
export function parseUserDetail(raw: unknown): AdminUserDetail | null {
  const r = obj(raw);
  const u = obj(r.user);
  if (!str(u.id)) return null;
  return {
    id: str(u.id)!,
    email: str(u.email) ?? '',
    name: str(u.display_name),
    createdAt: str(u.created_at) ?? '',
    lastSignInAt: str(u.last_sign_in_at),
    emailConfirmedAt: str(u.email_confirmed_at),
    provider: str(u.provider) ?? 'email',
    orgs: (Array.isArray(r.orgs) ? r.orgs : []).map(parseUserOrg),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un identifiant d'utilisateur lu dans l'adresse : refusé avant d'interroger la base s'il n'a pas la forme d'un UUID. */
export const isUserId = (v: string): boolean => UUID.test(v);

/** Total des résultats avant pagination, porté par chaque ligne (`count(*) over ()`). */
export const totalOf = (rows: unknown[]): number => (rows.length ? num(obj(rows[0]).total_count) : 0);

// ---------------------------------------------------------------- revenus

export interface Revenue {
  /** Revenu mensuel récurrent des abonnements payants, en dollars, au prix réellement payé. Ni les cadeaux ni un paiement en retard ne comptent. */
  mrr: number;
  arr: number;
  /** Ce que rapporteraient les essais en cours s'ils devenaient tous payants au tarif mensuel en dollars. */
  trialPotential: number;
  payingOrgs: number;
  /** Organisations dont l'abonnement est offert (hors revenu). */
  giftedOrgs: number;
}

/** Prix mensuel de référence en dollars d'une offre ; 0 pour une offre inconnue ou gratuite. */
const listPrice = (plan: string): number => (isPaidPlanId(plan) ? USD_MONTHLY[plan] : 0);

/**
 * Revenus. Le MRR est la somme des `monthly_usd` enregistrés à chaque paiement (remise locale, rythme annuel et monnaie compris) ; un abonnement dont
 * ce montant manque retombe sur le prix de référence. Les abonnements offerts sont comptés à part.
 */
export function revenue(byPlan: PlanCount[]): Revenue {
  let mrr = 0;
  let trialPotential = 0;
  let payingOrgs = 0;
  let giftedOrgs = 0;
  for (const r of byPlan) {
    if (r.phase === 'paying') {
      if (r.provider === 'gift') {
        giftedOrgs += r.count;
        continue;
      }
      mrr += r.mrrUsd > 0 ? r.mrrUsd : listPrice(r.plan) * r.count;
      payingOrgs += r.count;
    } else if (r.phase === 'trialing') {
      trialPotential += listPrice(r.plan) * r.count;
    }
  }
  mrr = Math.round(mrr * 100) / 100;
  return { mrr, arr: Math.round(mrr * 12 * 100) / 100, trialPotential, payingOrgs, giftedOrgs };
}

/** Part de `part` dans `whole`, en pourcentage entier (0 si `whole` est nul). */
export const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Jours entiers restants avant `iso` (arrondi au-dessus : « 0 » seulement quand c'est passé). Négatif si la date est dépassée. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY);
}

// ---------------------------------------------------------------- paramètres d'URL

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parsePhase(v: string | string[] | undefined): Phase | null {
  const s = first(v);
  return s && (PHASES as readonly string[]).includes(s) ? (s as Phase) : null;
}

export function parsePage(v: string | string[] | undefined): number {
  const n = Number(first(v));
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export const parseSearch = (v: string | string[] | undefined): string => (first(v) ?? '').trim().slice(0, 100);

export const parseListQuery = (params: Record<string, string | string[] | undefined>): ListQuery => ({
  search: parseSearch(params.q),
  phase: parsePhase(params.phase),
  page: parsePage(params.page),
});

export const pageCount = (total: number, size = PAGE_SIZE): number => Math.max(1, Math.ceil(total / size));

/** Adresse d'une liste avec ses filtres ; les valeurs vides sont omises. */
export function listHref(base: string, q: Partial<ListQuery>): string {
  const p = new URLSearchParams();
  if (q.search) p.set('q', q.search);
  if (q.phase) p.set('phase', q.phase);
  if (q.page && q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Réponse de `admin_user_status()`. */
export function parseUserStatus(raw: unknown): AdminUserStatus {
  const r = obj(raw);
  const s = obj(r.suspension);
  return {
    suspension: str(s.at) ? { at: str(s.at)!, reason: str(s.reason), byEmail: str(s.by_email) } : null,
    isPlatformAdmin: r.is_platform_admin === true,
  };
}

/** Message d'erreur de la base → résultat affiché sur la fiche. Les messages sont ceux levés par `admin_suspend_user`. */
export function suspensionFailure(message: string | undefined): Flash {
  const m = (message ?? '').toLowerCase();
  if (m.includes('cannot suspend yourself')) return 'self';
  if (m.includes('cannot suspend a platform admin')) return 'protected';
  return 'error';
}

/** `?ok=` de la fiche : seules les valeurs connues sont acceptées. */
export function parseFlash(v: string | string[] | undefined): Flash | null {
  const s = first(v);
  return s && (FLASHES as readonly string[]).includes(s) ? (s as Flash) : null;
}

/** Motif saisi dans le formulaire : sans espaces autour, 500 caractères au plus ; vide → absent. */
export function cleanReason(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim().slice(0, 500) : '';
  return s === '' ? null : s;
}

// ---------------------------------------------------------------- abonnement offert

export const GIFT_MONTHS = [1, 3, 6, 12] as const;

/** Durée choisie dans le formulaire : seules les durées proposées sont acceptées. */
export function parseGiftMonths(v: FormDataEntryValue | null): (typeof GIFT_MONTHS)[number] | null {
  const n = Number(v);
  return (GIFT_MONTHS as readonly number[]).includes(n) ? (n as (typeof GIFT_MONTHS)[number]) : null;
}

/** Fin d'un cadeau de `months` mois commencé maintenant (en UTC, fin de journée : le dernier jour compte en entier). */
export function giftEnd(months: number, now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate(), 23, 59, 59));
  return d;
}

/** Message d'erreur de la base → résultat affiché sur la fiche. Les messages sont ceux levés par `admin_grant_subscription`. */
export function giftFailure(message: string | undefined): Flash {
  const m = (message ?? '').toLowerCase();
  if (m.includes('has paid subscription')) return 'giftPaid';
  if (m.includes('invalid plan') || m.includes('invalid end date') || m.includes('organization not found')) return 'giftInvalid';
  return 'error';
}

const PAYMENT_STATUS = ['pending', 'succeeded', 'failed', 'expired', 'refunded'] as const;

/** Ligne de `admin_payments()` → paiement. */
export function parsePaymentRow(raw: unknown): AdminPayment {
  const r = obj(raw);
  const provider = r.provider === 'stripe' || r.provider === 'gift' ? r.provider : 'pawapay';
  const status = (PAYMENT_STATUS as readonly unknown[]).includes(r.status) ? (r.status as AdminPayment['status']) : 'pending';
  return {
    id: str(r.id) ?? '', orgId: str(r.org_id) ?? '', orgName: str(r.org_name) ?? '', ownerEmail: str(r.owner_email), provider, plan: str(r.plan) ?? '',
    months: num(r.months), amount: num(r.amount), currency: str(r.currency) ?? 'USD', usdAmount: num(r.usd_amount), country: str(r.country), status,
    failureReason: str(r.failure_reason), createdAt: str(r.created_at) ?? '', periodEnd: str(r.period_end),
  };
}
