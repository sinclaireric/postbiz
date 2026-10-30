import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui';
import { getT } from '@/i18n/server';
import { billingStore, providerConfigs } from '@/lib/billing/server';
import { confirmMobileMoney, type DepositOutcome } from '@/lib/billing/service';
import { getSession } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { AutoRefresh } from './auto-refresh';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('app.titles.billing'), robots: { index: false } };
}
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Retour de la page de paiement PawaPay. L'adresse ne prouve RIEN (n'importe qui peut l'ouvrir) : on relit le dépôt chez PawaPay et seul ce résultat
 * s'affiche et s'applique. Le dépôt doit appartenir à un espace dont la personne est administratrice (lecture sous la RLS).
 */
export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');

  const raw = (await searchParams).depositId;
  const depositId = Array.isArray(raw) ? raw[0] : raw;
  let outcome: DepositOutcome = 'unknown';

  if (depositId && UUID.test(depositId) && session.ctx.mode === 'supabase') {
    const supabase = await createClient();
    const { data: mine } = await supabase.from('payments').select('provider_ref').eq('provider', 'pawapay').eq('provider_ref', depositId).maybeSingle();
    const { pawapay } = providerConfigs();
    const store = billingStore();
    if (mine && pawapay && store) outcome = await confirmMobileMoney({ store, pawapay }, depositId).catch(() => 'error' as const);
  }

  const key = outcome === 'succeeded' ? 'succeeded' : outcome === 'review' ? 'review' : outcome;
  return (
    <div className="mx-auto w-full max-w-xl px-5 py-12 sm:px-8">
      <div className="rounded-3xl border border-line bg-surface p-8 text-center" role="status">
        <h1 className="text-2xl font-semibold tracking-tight">{t(`billing.return.${key}.title`)}</h1>
        <p className="mt-3 text-muted">{t(`billing.return.${key}.text`)}</p>
        {outcome === 'pending' && <AutoRefresh />}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/app/facturation" variant={outcome === 'succeeded' ? 'primary' : 'secondary'}>{t('billing.return.back')}</ButtonLink>
          {(outcome === 'failed' || outcome === 'expired' || outcome === 'error') && (
            <ButtonLink href="/app/facturation#changer" variant="primary">{t('billing.return.retry')}</ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}
