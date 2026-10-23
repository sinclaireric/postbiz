import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FieldList } from '@/components/admin/field-list';
import { MeterList } from '@/components/admin/meter-list';
import { PhaseBadge, PhaseCell, PlanCell } from '@/components/admin/phase-cell';
import { SocialIcon } from '@/components/social-icon';
import { Badge } from '@/components/ui';
import { formatFullDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { loadUserDetail } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/admin/guard';
import type { AdminChannel } from '@/lib/admin/types';
import { networkName } from '@/lib/networks';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.users') };
}
export const dynamic = 'force-dynamic';

const POST_STATES = ['published', 'queued', 'draft', 'error', 'unknown', 'publishing'] as const;
const card = 'rounded-3xl border border-line bg-surface p-6';
const h2 = 'text-lg font-semibold';
const h3 = 'text-xs font-bold tracking-[0.14em] text-muted uppercase';
const CHANNEL_TONE = { active: 'ok', refresh_needed: 'warn', disabled: 'neutral' } as const;

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const t = await getT();
  const user = await loadUserDetail(id);
  if (!user) notFound();

  const date = (iso: string | null) => (iso ? formatFullDate(t.locale, new Date(iso)) : null);
  const n = (v: number) => formatNumber(t.locale, v);
  const provider = user.provider === 'email' ? t('admin.user.providerEmail') : user.provider === 'google' ? t('admin.user.providerGoogle') : user.provider;
  const yesNo = (v: boolean) => t(v ? 'admin.user.yes' : 'admin.user.no');
  const primary = user.orgs[0]?.subscription ?? null;

  return (
    <>
      <Link href="/admin/utilisateurs" className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">← {t('admin.user.back')}</Link>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight">{user.name ?? user.email}</h1>
        {primary && <PhaseBadge phase={primary.phase} t={t} />}
        {!user.emailConfirmedAt && <Badge tone="warn">{t('admin.cell.unconfirmed')}</Badge>}
      </div>
      {user.name && user.name !== user.email && <p className="mt-1 text-muted" dir="ltr">{user.email}</p>}

      <section className={`${card} mt-6`} aria-labelledby="account">
        <h2 id="account" className={h2}>{t('admin.user.account')}</h2>
        <div className="mt-4">
          <FieldList items={[
            { label: t('admin.user.name'), value: user.name },
            { label: t('admin.user.email'), value: <span dir="ltr">{user.email}</span> },
            { label: t('admin.user.signedUp'), value: date(user.createdAt) },
            { label: t('admin.user.lastSeen'), value: date(user.lastSignInAt) ?? t('admin.cell.never') },
            { label: t('admin.user.confirmedOn'), value: date(user.emailConfirmedAt) ?? t('admin.user.notConfirmed') },
            { label: t('admin.user.provider'), value: provider },
            { label: t('admin.user.id'), value: <span dir="ltr" className="font-mono text-xs">{user.id}</span> },
          ]} />
        </div>
      </section>

      <h2 className={`${h2} mt-8`}>{t('admin.user.orgs')}</h2>
      {user.orgs.length === 0 && <p className="mt-3 rounded-3xl border border-line bg-surface px-6 py-8 text-center text-muted">{t('admin.user.noOrg')}</p>}

      {user.orgs.map((o) => {
        const sub = o.subscription;
        const total = Object.values(o.posts.byState).reduce((s, v) => s + v, 0);
        return (
          <section key={o.orgId} className={`${card} mt-4`} aria-labelledby={`org-${o.orgId}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 id={`org-${o.orgId}`} className="text-lg font-semibold">{o.name}</h3>
              <Badge tone={o.role === 'admin' ? 'lime' : 'neutral'}>{t(`common.role.${o.role}`)}</Badge>
              <span className="text-sm text-subtle">{t('admin.user.createdOn')} {date(o.createdAt)}</span>
            </div>

            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              <div>
                <p className={h3}>{t('admin.user.subscription')}</p>
                <div className="mt-3">
                  {sub ? (
                    <FieldList items={[
                      { label: t('admin.user.plan'), value: <PlanCell sub={sub} t={t} /> },
                      { label: t('admin.user.status'), value: <PhaseCell sub={sub} t={t} /> },
                      { label: t('admin.user.startedOn'), value: date(sub.createdAt) },
                      { label: t('admin.user.trialEnds'), value: date(sub.trialEndsAt) },
                      { label: t('admin.user.periodEnd'), value: date(sub.currentPeriodEnd) },
                      { label: t('admin.user.cancelAtEnd'), value: sub.phase === 'paying' ? yesNo(sub.cancelAtPeriodEnd) : null },
                      { label: t('admin.user.canceledOn'), value: date(sub.canceledAt) },
                      { label: t('admin.user.stripeCustomer'), value: sub.stripeCustomerId && <span dir="ltr" className="font-mono text-xs">{sub.stripeCustomerId}</span> },
                      { label: t('admin.user.stripeSubscription'), value: sub.stripeSubscriptionId && <span dir="ltr" className="font-mono text-xs">{sub.stripeSubscriptionId}</span> },
                    ]} />
                  ) : (
                    <p className="rounded-2xl bg-wash px-4 py-3 text-sm leading-relaxed text-muted">{t('admin.user.noSubscription')}</p>
                  )}
                </div>
              </div>

              <div>
                <p className={h3}>{t('admin.user.activity')}</p>
                <div className="mt-3 grid gap-5">
                  <FieldList items={[
                    { label: t('admin.user.members'), value: n(o.membersCount) },
                    { label: t('admin.user.channelsCount'), value: n(o.channels.length) },
                    { label: t('admin.user.postsTotal'), value: n(total) },
                    { label: t('admin.user.lastPublished'), value: date(o.posts.lastPublishedAt) },
                    { label: t('admin.user.lastCreated'), value: date(o.posts.lastCreatedAt) },
                  ]} />
                  {total > 0 && (
                    <MeterList
                      label={t('admin.usage.postsByState')} max={total}
                      items={POST_STATES.filter((s) => (o.posts.byState[s] ?? 0) > 0).map((s) => ({ key: s, label: t(`admin.postState.${s}`), value: o.posts.byState[s] ?? 0, display: n(o.posts.byState[s] ?? 0) }))}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="mt-8">
              <p className={h3}>{t('admin.user.channels')}</p>
              {o.channels.length === 0 ? (
                <p className="mt-3 text-sm text-muted">{t('admin.user.noChannels')}</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-start text-xs font-semibold tracking-wide text-muted uppercase">
                        <th scope="col" className="px-4 py-2.5 text-start">{t('admin.user.colNetwork')}</th>
                        <th scope="col" className="px-4 py-2.5 text-start">{t('admin.user.colName')}</th>
                        <th scope="col" className="px-4 py-2.5 text-start">{t('admin.user.colStatus')}</th>
                        <th scope="col" className="px-4 py-2.5 text-start whitespace-nowrap">{t('admin.user.colConnected')}</th>
                        <th scope="col" className="px-4 py-2.5 text-start whitespace-nowrap">{t('admin.user.colToken')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.channels.map((c: AdminChannel) => (
                        <tr key={c.id} className="border-t border-line">
                          <td className="px-4 py-3"><span className="flex items-center gap-2 font-medium"><SocialIcon id={c.provider as never} size={20} />{networkName(c.provider)}</span></td>
                          <td className="px-4 py-3"><p className="font-medium">{c.name}</p>{c.username && <p className="text-xs text-muted" dir="ltr">{c.username}</p>}</td>
                          <td className="px-4 py-3"><Badge tone={CHANNEL_TONE[c.status]}>{t(`admin.channelStatus.${c.status}`)}</Badge></td>
                          <td className="px-4 py-3 whitespace-nowrap">{date(c.createdAt)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{date(c.tokenExpiresAt) ?? <span className="text-subtle">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        );
      })}

      <p className="mt-6 text-xs text-subtle">{t('admin.user.privacyNote')}</p>
    </>
  );
}
