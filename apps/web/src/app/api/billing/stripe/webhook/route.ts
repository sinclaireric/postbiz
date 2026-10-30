import { NextResponse } from 'next/server';
import { billingStore, providerConfigs } from '@/lib/billing/server';
import { handleStripeEvent } from '@/lib/billing/service';
import { verifyStripeSignature } from '@/lib/billing/stripe';

export const dynamic = 'force-dynamic';

/**
 * Webhook Stripe. La signature est vérifiée sur le corps BRUT avant toute lecture ; l'événement ne sert que de déclencheur (l'abonnement est relu chez
 * Stripe) ; il est enregistré avec ses effets en une transaction, donc relivré il ne s'applique qu'une fois.
 * Réponses : 400 signature invalide (Stripe ne relivre pas), 503 non configuré, 500 panne passagère (Stripe relivre jusqu'à 3 jours), 200 sinon, y
 * compris pour un événement d'un autre site du même compte Stripe. Rien d'autre que le type d'événement n'est journalisé : jamais de secret.
 */
export async function POST(request: Request) {
  try {
    const { stripe } = providerConfigs();
    const store = billingStore();
    if (!stripe || !stripe.webhookSecrets.length || !store) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

    const payload = await request.text();
    const sig = verifyStripeSignature(payload, request.headers.get('stripe-signature'), stripe.webhookSecrets);
    if (!sig.ok) return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });

    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const outcome = await handleStripeEvent({ store, cfg: stripe }, event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error('[billing] webhook Stripe en échec :', e instanceof Error ? e.message.slice(0, 200) : 'erreur');
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}
