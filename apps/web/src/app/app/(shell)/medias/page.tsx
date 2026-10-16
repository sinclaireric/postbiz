import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MediaLibrary } from '@/components/media/media-library';
import { getRepositories, getSession } from '@/lib/data';

export const metadata: Metadata = { title: 'Médias' };
export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const items = await repos.media.list();
  return <MediaLibrary items={items} orgId={ctx.org.id} canWrite={ctx.org.role !== 'viewer'} demo={ctx.mode === 'demo'} />;
}
