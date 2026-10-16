import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CalendarView } from '@/components/calendar/calendar-view';
import { getRepositories, getSession } from '@/lib/data';

export const metadata: Metadata = { title: 'Calendrier' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const [posts, integrations] = await Promise.all([repos.posts.list(), repos.workspace.integrations()]);

  return <CalendarView posts={posts} integrations={integrations} canWrite={ctx.org.role !== 'viewer'} />;
}
