import { formatFullDate } from '@/i18n/format';
import type { T } from '@/i18n/types';
import { daysUntil } from '@/lib/admin/logic';
import type { Phase, SubscriptionInfo } from '@/lib/admin/types';
import { PLANS, planNameKey, type PlanId } from '@/lib/pricing';

const TONE: Record<Phase, string> = {
  trialing: 'bg-lime-soft text-forest',
  paying: 'bg-ok-soft text-ok',
  trial_expired: 'bg-warn-soft text-warn',
  past_due: 'bg-danger-soft text-danger',
  canceled: 'bg-wash text-muted',
  none: 'bg-wash text-muted',
};

export function PhaseBadge({ phase, t }: { phase: Phase; t: T }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[phase]}`}>{t(`admin.phase.${phase}`)}</span>;
}

/** Statut d'un abonnement avec, dessous, la date qui compte : fin d'essai, renouvellement ou fin de période. */
export function PhaseCell({ sub, t, now = new Date() }: { sub: SubscriptionInfo; t: T; now?: Date }) {
  const date = (iso: string) => formatFullDate(t.locale, new Date(iso));
  let detail: string | null = null;
  if (sub.phase === 'trialing' && sub.trialEndsAt) detail = t('admin.detail.trialEnds', { days: daysUntil(sub.trialEndsAt, now), date: date(sub.trialEndsAt) });
  else if (sub.phase === 'trial_expired' && sub.trialEndsAt) detail = t('admin.detail.trialEnded', { date: date(sub.trialEndsAt) });
  else if (sub.phase === 'paying' && sub.currentPeriodEnd) detail = t(sub.cancelAtPeriodEnd ? 'admin.detail.endsOn' : 'admin.detail.renews', { date: date(sub.currentPeriodEnd) });
  else if (sub.phase === 'past_due' && sub.currentPeriodEnd) detail = t('admin.detail.dueOn', { date: date(sub.currentPeriodEnd) });
  return (
    <div className="min-w-44">
      <PhaseBadge phase={sub.phase} t={t} />
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}

/** Offre et rythme de facturation, ou un tiret quand l'organisation n'a pas d'abonnement. */
export function PlanCell({ sub, t }: { sub: SubscriptionInfo; t: T }) {
  if (!sub.plan) return <span className="text-subtle">{t('admin.cell.noPlan')}</span>;
  const known = PLANS.some((p) => p.id === sub.plan);
  return (
    <div>
      <p className="font-medium">{known ? t(planNameKey(sub.plan as PlanId)) : sub.plan}</p>
      {sub.interval && <p className="text-xs text-muted">{t(`admin.interval.${sub.interval}`)}</p>}
    </div>
  );
}
