'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';
import { validatePost, type PostMode } from '@/lib/posts/logic';

export interface PostFormState {
  errors?: string[];
  savedAt?: number;
}

export async function createPostAction(_: PostFormState, formData: FormData): Promise<PostFormState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  if (ctx.org.role === 'viewer') return { errors: [t('app.composer.viewerNote')] };

  const mode: PostMode = formData.get('mode') === 'schedule' ? 'schedule' : 'draft';
  const content = String(formData.get('content') ?? '');
  const ids = formData.getAll('integrationId').map(String);
  const publishAtRaw = String(formData.get('publishAt') ?? '');
  const publishAt = publishAtRaw ? publishAtRaw : null;

  const repos = await getRepositories(ctx);
  const integrations = await repos.workspace.integrations();
  const chosen = integrations.filter((i) => ids.includes(i.id));
  const inactive = chosen.filter((i) => i.status !== 'active');
  if (inactive.length > 0) {
    return { errors: [t('app.composer.errReconnect', { names: inactive.map((i) => i.name).join(', ') })] };
  }

  const errors = validatePost({ content, networkIds: chosen.map((i) => i.networkId), publishAt, mode });
  if (errors.length > 0) return { errors: errors.map((e) => errorText(t, e)) };

  const res = await repos.posts.create({
    integrationIds: chosen.map((i) => i.id),
    content,
    publishAt: publishAt ? new Date(publishAt).toISOString() : null,
    mode,
  });
  if (!res.ok) return { errors: [res.error ? errorText(t, res.error) : t('app.composer.errSave')] };
  revalidatePath('/app/calendrier');
  return { savedAt: Date.now() };
}

export async function deletePostAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return;
  const repos = await getRepositories(session.ctx);
  await repos.posts.remove(String(formData.get('groupId') ?? ''));
  revalidatePath('/app/calendrier');
}
