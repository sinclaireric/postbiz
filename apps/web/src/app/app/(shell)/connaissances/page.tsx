import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnowledgeView } from '@/components/knowledge/knowledge-view';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { embeddingsConfigured } from '@/lib/kb/embed';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.knowledgeApp') };
}
export const dynamic = 'force-dynamic';

/**
 * La base de connaissance : ce que l'IA sait de l'activité, pour l'agent, le composeur et l'inbox. Lisible par tous les membres, modifiable par les
 * administrateurs et les membres. Sans clé OpenAI côté serveur (et en démonstration), la recherche se fait par les mots seulement.
 */
export default async function KnowledgePage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const items = await repos.knowledge.list();
  return <KnowledgeView items={items} canWrite={ctx.org.role !== 'viewer'} embeddings={ctx.mode !== 'demo' && embeddingsConfigured()} demo={ctx.mode === 'demo'} orgId={ctx.org.id} />;
}
