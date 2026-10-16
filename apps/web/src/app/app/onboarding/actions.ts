'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/data';
import { demoConnectChannel } from '@/lib/data/demo';
import { networkById } from '@/lib/networks';

/** Mode démo uniquement : simule la connexion d'un canal pour pouvoir parcourir l'onboarding sans OAuth. */
export async function connectDemoChannelAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.mode !== 'demo') return;
  const network = networkById(String(formData.get('networkId') ?? ''));
  if (!network) return;
  demoConnectChannel(network.id, `${network.name} (démo)`);
  revalidatePath('/app', 'layout');
}
