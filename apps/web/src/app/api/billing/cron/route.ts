import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { billingStore, providerConfigs, serviceBillingClient } from '@/lib/billing/server';
import { reconcilePending } from '@/lib/billing/service';

export const dynamic = 'force-dynamic';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Tâche quotidienne (Vercel Cron, voir vercel.json) : rapproche les dépôts mobile money restés en attente (rappel perdu), et aligne les statuts des
 * abonnements dont la période est terminée. Protégée par `CRON_SECRET` (Vercel l'envoie en `Authorization: Bearer …`) ; sans ce secret, elle refuse tout.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !same(given, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const store = billingStore();
    const admin = serviceBillingClient();
    if (!store || !admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    const { pawapay } = providerConfigs();
    const reconciled = pawapay ? await reconcilePending({ store, pawapay }) : null;
    const { data, error } = await admin.rpc('billing_expire_lapsed');
    if (error) throw new Error(error.message);
    return NextResponse.json({ reconciled, lapsed: data });
  } catch (e) {
    console.error('[billing] tâche quotidienne en échec :', e instanceof Error ? e.message.slice(0, 200) : 'erreur');
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}
