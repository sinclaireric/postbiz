import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CalendarView } from '@/components/calendar/calendar-view';
import { getT } from '@/i18n/server';
import { aiConfigured } from '@/lib/ai/assistant';
import { getRepositories, getSession } from '@/lib/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.calendar') };
}
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const [posts, integrations, knowledge] = await Promise.all([repos.posts.list(), repos.workspace.integrations(), repos.knowledge.list()]);

  return <CalendarView posts={posts} integrations={integrations} knowledge={knowledge} aiEnabled={aiConfigured()} canWrite={ctx.org.role !== 'viewer'} orgId={ctx.org.id} userId={ctx.user.id} demo={ctx.mode === 'demo'} />;
}
