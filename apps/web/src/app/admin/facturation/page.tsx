import type { Metadata } from 'next';
import { Badge, Button } from '@/components/ui';
import { formatFullDate } from '@/i18n/format';
import { LOCALE_META } from '@/i18n/config';
import { getT } from '@/i18n/server';
import { loadBillingAdmin } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/admin/guard';
import { planNameKey, isPlanId } from '@/lib/billing/plans';
import { formatMoney } from '@/lib/billing/price';
import { providerConfigs } from '@/lib/billing/server';
import { setBillingEnabledAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.billing') };
}
export const dynamic = 'force-dynamic';

const card = 'rounded-3xl border border-line bg-surface p-6';
const h2 = 'text-lg font-semibold';

export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const t = await getT();
  const tag = LOCALE_META[t.locale].tag;
  const raw = (await searchParams).ok;
  const ok = Array.isArray(raw) ? raw[0] : raw;
  const { enabled, payments } = await loadBillingAdmin();
  const cfg = providerConfigs();
  const cron = Boolean(process.env.CRON_SECRET?.trim());

  const flash = ok === 'on' ? t('admin.billing.flashOn') : ok === 'off' ? t('admin.billing.flashOff') : ok === 'demo' ? t('admin.suspend.flash.demo') : ok === 'error' ? t('admin.billing.flashError') : null;
  const status = (label: string, good: boolean, detail?: string) => (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2 text-sm text-muted">{detail}<Badge tone={good ? 'ok' : 'warn'}>{good ? 'OK' : t('admin.billing.missing')}</Badge></span>
    </li>
  );

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">{t('admin.billing.title')}</h1>
      <p className="mt-1 text-muted">{t('admin.billing.subtitle')}</p>
      {flash && <p role="status" className={`mt-5 rounded-2xl px-4 py-3 text-sm font-medium ${ok === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>{flash}</p>}

      <section className={`${card} mt-6`} aria-labelledby="etat">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="etat" className={h2}>{t('admin.billing.state')}</h2>
          <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? 'ON' : 'OFF'}</Badge>
        </div>
        <p className="mt-3 text-[15px]">{enabled ? t('admin.billing.on') : t('admin.billing.off')}</p>
        {!enabled && <p className="mt-2 text-sm text-muted">{t('admin.billing.enableWarn')}</p>}
        <form action={setBillingEnabledAction} className="mt-4">
          <input type="hidden" name="enable" value={enabled ? '0' : '1'} />
          <Button type="submit" variant={enabled ? 'secondary' : 'primary'} size="sm">{enabled ? t('admin.billing.disable') : t('admin.billing.enable')}</Button>
        </form>
      </section>

      <section className={`${card} mt-6`} aria-labelledby="fournisseurs">
        <h2 id="fournisseurs" className={h2}>{t('admin.billing.providers')}</h2>
        <ul className="mt-2 divide-y divide-line">
          {status(t('admin.billing.stripe'), cfg.stripe !== null, cfg.stripe ? t('admin.billing.configured', { mode: cfg.stripe.mode }) : undefined)}
          {status(t('admin.billing.pawapay'), cfg.pawapay !== null, cfg.pawapay ? t('admin.billing.configured', { mode: cfg.pawapay.env }) : undefined)}
          {status(t('admin.billing.cron'), cron)}
        </ul>
      </section>

      <section className={`${card} mt-6`} aria-labelledby="paiements">
        <h2 id="paiements" className={h2}>{t('admin.billing.payments')}</h2>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('admin.billing.noPayments')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('billing.history.date')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('admin.billing.org')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('billing.history.plan')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('billing.history.method')}</th>
                  <th scope="col" className="py-2 pe-3 text-end font-medium">{t('billing.history.amount')}</th>
                  <th scope="col" className="py-2 text-start font-medium">{t('billing.history.status')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pe-3">{formatFullDate(t.locale, new Date(p.createdAt))}</td>
                    <td className="py-2.5 pe-3"><span className="block font-medium">{p.orgName}</span>{p.ownerEmail && <span className="block text-xs text-muted" dir="ltr">{p.ownerEmail}</span>}</td>
                    <td className="py-2.5 pe-3">{isPlanId(p.plan) ? t(planNameKey(p.plan)) : p.plan}</td>
                    <td className="py-2.5 pe-3">{t(`billing.provider.${p.provider}`)}{p.country ? ` · ${p.country}` : ''}</td>
                    <td className="py-2.5 pe-3 text-end" dir="ltr">{p.provider === 'gift' ? '—' : `${formatMoney(tag, p.amount, p.currency)}${p.currency !== 'USD' ? ` (≈ ${formatMoney(tag, p.usdAmount, 'USD')})` : ''}`}</td>
                    <td className="py-2.5"><Badge tone={p.status === 'succeeded' ? 'ok' : p.status === 'pending' ? 'neutral' : 'warn'}>{t(`billing.status.${p.status}`)}</Badge>{p.failureReason && <span className="mt-0.5 block text-xs text-muted">{p.failureReason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
