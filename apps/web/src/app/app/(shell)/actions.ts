'use server';

import { revalidatePath } from 'next/cache';
import { getRepositories, getSession } from '@/lib/data';

export async function markNotificationsReadAction(): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') return;
  const repos = await getRepositories(session.ctx);
  await repos.workspace.markNotificationsRead();
  revalidatePath('/app', 'layout');
}
