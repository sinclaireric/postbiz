import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SupportChat } from '@/components/support/support-chat';
import { getT } from '@/i18n/server';
import { getSession } from '@/lib/data';
import { loadSupportThread } from '@/lib/support/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('app.support.title') };
}
export const dynamic = 'force-dynamic';

/**
 * Écrire au support de Postbiz. Une conversation par personne, visible d'elle seule (et du propriétaire de la plateforme) : les autres membres
 * de l'espace de travail ne la voient pas. Sans projet Supabase (démonstration), le fil vit en mémoire du serveur.
 */
export default async function SupportPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const thread = await loadSupportThread(ctx);
  return <SupportChat initial={thread} realtime={ctx.mode === 'supabase'} demo={ctx.mode === 'demo'} />;
}
