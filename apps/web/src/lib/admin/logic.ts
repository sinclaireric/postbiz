import { PLANS, pricePerMonth } from '@/lib/pricing';
import { PHASES, type AdminOrgRow, type AdminOverview, type AdminUserRow, type ListQuery, type Phase, type PlanCount } from './types';

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
    byPlan: (Array.isArray(o.by_plan) ? o.by_plan : []).map((r): PlanCount => {
      const row = obj(r);
      return { plan: str(row.plan) ?? '', interval: row.interval === 'yearly' ? 'yearly' : 'monthly', phase: asPhase(row.phase), count: num(row.count) };
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

/** Total des résultats avant pagination, porté par chaque ligne (`count(*) over ()`). */
export const totalOf = (rows: unknown[]): number => (rows.length ? num(obj(rows[0]).total_count) : 0);

// ---------------------------------------------------------------- revenus

export interface Revenue {
  /** Revenu mensuel récurrent des abonnements payants, en euros. Un paiement en retard n'est pas compté tant qu'il n'est pas régularisé. */
  mrr: number;
  arr: number;
  /** Ce que rapporteraient les essais en cours s'ils devenaient tous payants. */
  trialPotential: number;
  payingOrgs: number;
}

/** Prix mensuel affiché d'une offre selon le rythme de facturation ; 0 pour une offre inconnue. */
function monthlyPrice(plan: string, interval: 'monthly' | 'yearly'): number {
  const p = PLANS.find((x) => x.id === plan);
  return p ? pricePerMonth(p, interval) : 0;
}

/** Revenus calculés avec les tarifs publiés (lib/pricing.ts) : la base ne connaît que l'offre et le rythme de facturation. */
export function revenue(byPlan: PlanCount[]): Revenue {
  let mrr = 0;
  let trialPotential = 0;
  let payingOrgs = 0;
  for (const r of byPlan) {
    const amount = monthlyPrice(r.plan, r.interval) * r.count;
    if (r.phase === 'paying') {
      mrr += amount;
      payingOrgs += r.count;
    } else if (r.phase === 'trialing') {
      trialPotential += amount;
    }
  }
  return { mrr, arr: mrr * 12, trialPotential, payingOrgs };
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
