import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FieldList } from '@/components/admin/field-list';
import { MeterList } from '@/components/admin/meter-list';
import { PhaseBadge, PhaseCell, PlanCell, SuspendedBadge } from '@/components/admin/phase-cell';
import { SocialIcon } from '@/components/social-icon';
import { Badge } from '@/components/ui';
import { formatFullDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { loadUserDetail, loadUserStatus } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/admin/guard';
import { parseFlash } from '@/lib/admin/logic';
import type { AdminChannel } from '@/lib/admin/types';
import { networkName } from '@/lib/networks';
import { restoreUserAction, suspendUserAction } from './actions';

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

export default async function AdminUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const flash = parseFlash((await searchParams).ok);
  const t = await getT();
  const user = await loadUserDetail(id);
  if (!user) notFound();
  const status = await loadUserStatus(id);
  const suspension = status.suspension;
  const canSuspend = !suspension && id !== admin.id && !status.isPlatformAdmin;

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
        {suspension && <SuspendedBadge t={t} />}
        {!user.emailConfirmedAt && <Badge tone="warn">{t('admin.cell.unconfirmed')}</Badge>}
      </div>
      {user.name && user.name !== user.email && <p className="mt-1 text-muted" dir="ltr">{user.email}</p>}

      {flash && (
        <p role="status" className={`mt-5 rounded-2xl px-4 py-3 text-sm font-medium ${flash === 'suspended' || flash === 'restored' ? 'bg-ok-soft text-ok' : flash === 'demo' ? 'bg-wash text-muted' : 'bg-danger-soft text-danger'}`}>
          {t(`admin.suspend.flash.${flash}`)}
        </p>
      )}

      {suspension && (
        <section className="mt-5 rounded-3xl border border-danger/30 bg-danger-soft p-6" aria-labelledby="suspended">
          <h2 id="suspended" className="text-lg font-semibold text-danger">{t('admin.suspend.bannerTitle', { date: date(suspension.at) ?? '' })}</h2>
          {suspension.reason && <p className="mt-2 text-sm">{t('admin.suspend.reason', { reason: suspension.reason })}</p>}
          {suspension.byEmail && <p className="mt-1 text-xs text-muted">{t('admin.suspend.by', { email: suspension.byEmail })}</p>}
          <p className="mt-3 text-sm text-muted">{t('admin.suspend.restoreNote')}</p>
          <form action={restoreUserAction} className="mt-4">
            <input type="hidden" name="user" value={user.id} />
            <button type="submit" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white hover:bg-black/80">{t('admin.suspend.restore')}</button>
          </form>
        </section>
      )}

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

      {!suspension && (
        <section className={`${card} mt-8`} aria-labelledby="suspension">
          <h2 id="suspension" className={h2}>{t('admin.suspend.title')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t('admin.suspend.explain')}</p>
          {canSuspend ? (
            <details className="group mt-4">
              <summary className="inline-flex h-10 cursor-pointer list-none items-center rounded-full border border-danger/40 px-5 text-sm font-semibold text-danger hover:bg-danger-soft [&::-webkit-details-marker]:hidden">{t('admin.suspend.open')}</summary>
              <form action={suspendUserAction} className="mt-4 grid max-w-xl gap-3">
                <input type="hidden" name="user" value={user.id} />
                <label className="grid gap-1 text-xs font-semibold text-muted">
                  {t('admin.suspend.reasonLabel')}
                  <textarea name="reason" rows={3} maxLength={500} placeholder={t('admin.suspend.reasonPlaceholder')} className="rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] font-normal text-ink outline-none focus:border-ink focus:ring-4 focus:ring-lime/40" />
                </label>
                <div>
                  <button type="submit" className="inline-flex h-10 items-center rounded-full bg-danger px-5 text-sm font-semibold text-white hover:brightness-110">{t('admin.suspend.confirm')}</button>
                </div>
              </form>
            </details>
          ) : (
            <p className="mt-4 rounded-2xl bg-wash px-4 py-3 text-sm text-muted">{t('admin.suspend.protected')}</p>
          )}
        </section>
      )}

      <p className="mt-6 text-xs text-subtle">{t('admin.user.privacyNote')}</p>
    </>
  );
}
