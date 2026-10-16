'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/data';
import { confirmSelection, disconnectChannel } from '@/lib/oauth/flow';
import { createFlowDeps } from '@/lib/oauth/server';

export async function disconnectAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const deps = createFlowDeps();
  if (session.ctx.mode === 'demo' || !deps) redirect('/app/canaux?erreur=non_configure');

  const r = await disconnectChannel(deps, { userId: session.ctx.user.id, orgId: session.ctx.org.id, integrationId: String(formData.get('integrationId') ?? '') });
  revalidatePath('/app/canaux');
  redirect(r.ok ? `/app/canaux?deconnecte=1${r.cleanupFailed ? '&nettoyage=ko' : ''}` : `/app/canaux?erreur=${r.error}`);
}

export async function confirmSelectionAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const deps = createFlowDeps();
  if (session.ctx.mode === 'demo' || !deps) redirect('/app/canaux?erreur=non_configure');

  const pendingId = String(formData.get('pendingId') ?? '');
  const r = await confirmSelection(deps, { userId: session.ctx.user.id, pendingId, keys: formData.getAll('account').map(String) });
  revalidatePath('/app/canaux');
  if (r.kind === 'connected') redirect(`/app/canaux?connecte=${r.count}&reseau=${r.network}${r.webhookWarnings > 0 ? '&webhooks=ko' : ''}`);
  if (r.kind === 'error' && r.code === 'selection_vide') redirect(`/app/canaux/connecter/${encodeURIComponent(pendingId)}?erreur=selection_vide`);
  redirect(`/app/canaux?erreur=${r.kind === 'error' ? r.code : 'erreur'}`);
}
