import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AgentView } from '@/components/agent/agent-view';
import { getT } from '@/i18n/server';
import { loadThread } from '@/lib/agent/load';
import { agentConfigured } from '@/lib/agent/config';
import { getRepositories, getSession } from '@/lib/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.agentApp') };
}
export const dynamic = 'force-dynamic';

/**
 * L'agent : une conversation qui prépare des publications pour les canaux cochés. Réservé aux administrateurs et aux membres (comme l'assistant du
 * composeur) ; sans clé d'API côté serveur la page s'affiche avec un état clair, et le mode démo répond par des réponses simulées.
 */
export default async function AgentPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const canWrite = ctx.org.role !== 'viewer';
  const repos = await getRepositories(ctx);
  const { c } = await searchParams;
  const [integrations, threads, initial] = await Promise.all([
    repos.workspace.integrations(),
    canWrite ? repos.agent.threads() : Promise.resolve([]),
    canWrite && c && /^[\w-]{1,64}$/.test(c) ? loadThread(repos, c) : Promise.resolve(null),
  ]);

  return (
    <AgentView
      // Une autre conversation (ou une nouvelle) repart d'un état vierge.
      key={initial?.thread.id ?? 'new'}
      integrations={integrations} threads={threads} initial={initial} canWrite={canWrite} aiEnabled={ctx.mode === 'demo' || agentConfigured()}
      demo={ctx.mode === 'demo'} orgId={ctx.org.id} userId={ctx.user.id}
    />
  );
}
