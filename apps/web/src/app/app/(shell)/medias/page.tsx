import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MediaLibrary } from '@/components/media/media-library';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.media') };
}
export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const items = await repos.media.list();
  return <MediaLibrary items={items} orgId={ctx.org.id} canWrite={ctx.org.role !== 'viewer'} demo={ctx.mode === 'demo'} />;
}
