import { NextResponse } from 'next/server';
import { billingStore, providerConfigs } from '@/lib/billing/server';
import { confirmMobileMoney } from '@/lib/billing/service';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rappel de PawaPay (adresse à déclarer dans leur tableau de bord). Le corps n'est JAMAIS cru : on n'en retient que l'identifiant du dépôt, puis on
 * relit le dépôt chez PawaPay avec notre jeton (`confirmMobileMoney`). Un faux rappel ne peut donc rien activer, et un rappel rejoué est sans effet.
 * 200 = pris en compte (ou sans objet) ; 500 = panne passagère, PawaPay relivre (8 essais en ~25 minutes) ; le rapprochement planifié rattrape le reste.
 */
export async function POST(request: Request) {
  try {
    const { pawapay } = providerConfigs();
    const store = billingStore();
    if (!pawapay || !store) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

    const body: unknown = await request.json().catch(() => null);
    const id = body && typeof body === 'object' ? (body as { depositId?: unknown }).depositId : null;
    if (typeof id !== 'string' || !UUID.test(id)) return NextResponse.json({ received: true });

    const outcome = await confirmMobileMoney({ store, pawapay }, id);
    return NextResponse.json({ received: true }, { status: outcome === 'error' ? 500 : 200 });
  } catch (e) {
    console.error('[billing] rappel PawaPay en échec :', e instanceof Error ? e.message.slice(0, 200) : 'erreur');
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}
