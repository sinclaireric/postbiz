import { USD_MONTHLY } from '@/lib/billing/plans';
import { PHASES, type AdminChannel, type AdminOrgRow, type AdminOverview, type AdminPage, type AdminUserDetail, type AdminUserRow, type AdminUserStatus, type ListQuery, type Phase, type PlanCount } from './types';
import { PAGE_SIZE } from './logic';

// Données d'exemple de l'espace propriétaire (mode démo, sans Supabase). Déterministes, sauf les dates qui suivent l'horloge.
const DAY = 86_400_000;

const FIRST = ['Léa', 'Hugo', 'Inès', 'Karim', 'Chloé', 'Maxime', 'Sarah', 'Théo', 'Camille', 'Nadia', 'Louis', 'Manon', 'Yanis', 'Julie', 'Antoine', 'Emma', 'Rayan', 'Clara', 'Paul', 'Zoé'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefèvre', 'Garcia', 'Roux', 'Fournier', 'Girard', 'Bonnet', 'Mercier', 'Blanc'];
const COMPANIES = ['Atelier Lune', 'Maison Verte', 'Studio Orange', 'Café du Port', 'Boulangerie Dupain', 'Cabinet Rivière', 'Yoga Aurore', 'Garage Lambert', 'Fleurs & Co', 'Agence Pixel', 'Librairie Mots Bleus', 'Coiffure Éclat'];
const PLAN_OF: Array<'free' | 'standard' | 'team' | 'agency'> = ['standard', 'standard', 'agency', 'team', 'standard'];

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Account {
  user: AdminUserRow;
  org: AdminOrgRow;
}

function build(now: Date): Account[] {
  const rand = rng(2026);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const iso = (ms: number) => new Date(ms).toISOString();
  const accounts: Account[] = [];

  for (let i = 0; i < 46; i++) {
    const ageDays = i < 9 ? Math.floor(rand() * 7) : Math.floor(rand() * 75); // quelques inscrits de la semaine, puis des comptes plus anciens
    const created = now.getTime() - ageDays * DAY - Math.floor(rand() * DAY);
    const first = pick(FIRST);
    const last = pick(LAST);
    const company = `${pick(COMPANIES)}${i % 4 === 0 ? ' ' + (i + 2) : ''}`;
    const plan = pick(PLAN_OF);
    const interval: 'monthly' | 'yearly' = rand() < 0.3 ? 'yearly' : 'monthly';

    // Phase selon l'ancienneté : un essai dure 14 jours.
    let phase: Phase;
    const r = rand();
    if (ageDays <= 13) phase = r < 0.12 ? 'paying' : 'trialing';
    else phase = r < 0.28 ? 'paying' : r < 0.36 ? 'canceled' : r < 0.4 ? 'past_due' : r < 0.9 ? 'trial_expired' : 'none';

    const trialEnd = created + 14 * DAY;
    const sub = {
      plan: phase === 'none' ? null : plan,
      interval: phase === 'none' ? null : interval,
      phase,
      trialEndsAt: phase === 'trialing' || phase === 'trial_expired' ? iso(trialEnd) : null,
      currentPeriodEnd: phase === 'paying' || phase === 'past_due' ? iso(now.getTime() + (3 + Math.floor(rand() * 26)) * DAY) : null,
      cancelAtPeriodEnd: phase === 'paying' && rand() < 0.12,
    };
    const channels = phase === 'none' || rand() < 0.15 ? Math.floor(rand() * 2) : 1 + Math.floor(rand() * 5);
    const posts = channels === 0 ? 0 : Math.floor(rand() * 80);
    const lastSeen = rand() < 0.2 ? null : created + Math.floor(rand() * (now.getTime() - created));
    const email = `${first}.${last}${i}@${['gmail.com', 'outlook.fr', 'proton.me', 'orange.fr'][i % 4]}`
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const orgId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const userId = `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`;
    const members = phase === 'paying' && plan === 'team' ? 2 + Math.floor(rand() * 4) : 1;

    accounts.push({
      user: {
        ...sub, userId, email, name: `${first} ${last}`, createdAt: iso(created), lastSignInAt: lastSeen ? iso(lastSeen) : null,
        emailConfirmed: rand() > 0.07, orgId, orgName: company, role: 'admin', orgsCount: 1, channelsCount: channels, postsCount: posts, suspended: i % 17 === 5,
      },
      org: { ...sub, orgId, name: company, createdAt: iso(created), ownerEmail: email, membersCount: members, channelsCount: channels, postsCount: posts },
    });
  }
  return accounts.sort((a, b) => b.user.createdAt.localeCompare(a.user.createdAt));
}

const matches = (q: ListQuery, ...texts: Array<string | null>) =>
  !q.search || texts.some((t) => t?.toLowerCase().includes(q.search.toLowerCase()));

function paginate<T>(rows: T[], q: ListQuery): AdminPage<T> {
  return { rows: rows.slice((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE), total: rows.length };
}

export function demoUsers(q: ListQuery, now = new Date()): AdminPage<AdminUserRow> {
  return paginate(
    build(now).map((a) => a.user).filter((u) => matches(q, u.email, u.name, u.orgName) && (!q.phase || u.phase === q.phase)),
    q
  );
}

export function demoOrganizations(q: ListQuery, now = new Date()): AdminPage<AdminOrgRow> {
  return paginate(
    build(now).map((a) => a.org).filter((o) => matches(q, o.name, o.ownerEmail) && (!q.phase || o.phase === q.phase)),
    q
  );
}

export function demoOverview(now = new Date()): AdminOverview {
  const accounts = build(now);
  const users = accounts.map((a) => a.user);
  const since = (days: number) => users.filter((u) => now.getTime() - new Date(u.createdAt).getTime() < days * DAY).length;

  const phases = Object.fromEntries(PHASES.map((p) => [p, users.filter((u) => u.phase === p).length])) as Record<Phase, number>;
  const byPlan = new Map<string, PlanCount>();
  for (const u of users) {
    if (!u.plan || !u.interval) continue;
    const key = `${u.plan}|${u.interval}|${u.phase}`;
    const row = byPlan.get(key) ?? { plan: u.plan, interval: u.interval, phase: u.phase, provider: 'none', count: 0, mrrUsd: 0 };
    row.count += 1;
    row.mrrUsd += u.phase === 'paying' ? USD_MONTHLY[u.plan as keyof typeof USD_MONTHLY] ?? 0 : 0;
    byPlan.set(key, row);
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const signups = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(today.getTime() - (29 - i) * DAY);
    const key = day.toISOString().slice(0, 10);
    return { day: key, count: users.filter((u) => u.createdAt.slice(0, 10) === key).length };
  });

  return {
    users: {
      total: users.length,
      new7d: since(7),
      new30d: since(30),
      active7d: users.filter((u) => u.lastSignInAt && now.getTime() - new Date(u.lastSignInAt).getTime() < 7 * DAY).length,
      unconfirmed: users.filter((u) => !u.emailConfirmed).length,
    },
    orgs: {
      total: users.length,
      withChannel: users.filter((u) => u.channelsCount > 0).length,
      withPublished: users.filter((u) => u.postsCount > 10).length,
    },
    phases,
    trialsEnding3d: users.filter((u) => u.phase === 'trialing' && u.trialEndsAt && new Date(u.trialEndsAt).getTime() - now.getTime() <= 3 * DAY).length,
    cancelAtPeriodEnd: users.filter((u) => u.cancelAtPeriodEnd).length,
    gifts: 0,
    byPlan: [...byPlan.values()],
    channels: {
      total: users.reduce((n, u) => n + u.channelsCount, 0),
      needsReconnect: 4,
      byProvider: { instagram: 31, facebook: 22, linkedin: 17, x: 9, youtube: 5, tiktok: 3 },
    },
    posts: { created7d: 214, byState: { published: 1180, queued: 96, draft: 143, error: 17, unknown: 2 } },
    signups,
  };
}

const PROVIDERS = ['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok'];

/** Fiche détaillée d'un compte d'exemple : ses canaux et ses chiffres de publication sont déduits de la ligne de la liste. */
export function demoUserDetail(id: string, now = new Date()): AdminUserDetail | null {
  const account = build(now).find((a) => a.user.userId === id);
  if (!account) return null;
  const { user: u, org: o } = account;
  const created = new Date(u.createdAt).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();

  const channels: AdminChannel[] = Array.from({ length: u.channelsCount }, (_, i) => ({
    id: `${id.slice(0, -2)}c${i}`,
    provider: PROVIDERS[(Number(id.slice(-2)) + i) % PROVIDERS.length]!,
    name: i === 0 ? o.name : `${o.name} · ${i + 1}`,
    username: i === 0 ? null : `@${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}${i + 1}`,
    status: i === 2 && u.channelsCount > 2 ? 'refresh_needed' : 'active',
    createdAt: iso(created + (i + 1) * 3_600_000),
    tokenExpiresAt: iso(now.getTime() + (20 + i * 9) * DAY),
  }));
  const published = Math.round(u.postsCount * 0.7);
  const queued = Math.round(u.postsCount * 0.15);
  const byState: Record<string, number> = { published, queued, draft: u.postsCount - published - queued };

  return {
    id, email: u.email, name: u.name, createdAt: u.createdAt, lastSignInAt: u.lastSignInAt,
    emailConfirmedAt: u.emailConfirmed ? iso(created + 600_000) : null,
    provider: Number(id.slice(-2)) % 3 === 0 ? 'google' : 'email',
    orgs: [{
      orgId: o.orgId, name: o.name, createdAt: o.createdAt, role: 'admin', membersCount: o.membersCount,
      subscription: o.plan && o.interval ? {
        plan: o.plan, interval: o.interval, phase: o.phase, status: o.phase === 'paying' ? 'active' : o.phase === 'trial_expired' ? 'trialing' : o.phase,
        trialEndsAt: o.trialEndsAt, currentPeriodEnd: o.currentPeriodEnd, cancelAtPeriodEnd: o.cancelAtPeriodEnd,
        canceledAt: o.phase === 'canceled' ? iso(now.getTime() - 4 * DAY) : null,
        stripeCustomerId: o.phase === 'paying' || o.phase === 'past_due' || o.phase === 'canceled' ? `cus_demo${id.slice(-4)}` : null,
        stripeSubscriptionId: o.phase === 'paying' || o.phase === 'past_due' || o.phase === 'canceled' ? `sub_demo${id.slice(-4)}` : null,
        createdAt: o.createdAt,
        provider: o.phase === 'paying' || o.phase === 'past_due' ? 'stripe' : 'none', currency: o.phase === 'paying' ? 'USD' : null, country: null,
        monthlyUsd: o.phase === 'paying' ? USD_MONTHLY[o.plan as keyof typeof USD_MONTHLY] ?? null : null, graceEndsAt: null, giftNote: null,
        effectivePlan: o.phase === 'paying' || o.phase === 'trialing' ? o.plan : 'free',
      } : null,
      channels,
      posts: {
        byState,
        lastPublishedAt: published > 0 ? iso(now.getTime() - 2 * DAY) : null,
        lastCreatedAt: u.postsCount > 0 ? iso(now.getTime() - DAY) : null,
      },
    }],
  };
}

/** Un compte d'exemple sur dix-sept est suspendu : de quoi voir l'écran sans rien modifier. */
export function demoUserStatus(id: string, now = new Date()): AdminUserStatus {
  const account = build(now).find((a) => a.user.userId === id);
  return {
    suspension: account?.user.suspended ? { at: new Date(now.getTime() - 3 * DAY).toISOString(), reason: 'Messages non sollicités envoyés en masse.', byEmail: 'proprietaire@postbiz.demo' } : null,
    isPlatformAdmin: false,
  };
}
