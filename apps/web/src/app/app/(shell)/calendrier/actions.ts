'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { ALT_MAX } from '@/lib/media/logic';
import { MAX_MEDIA_PER_POST } from '@/lib/media/rules';
import type { PostMode } from '@/lib/posts/logic';
import { savePost } from '@/lib/posts/save';

export interface PostFormState {
  errors?: string[];
  savedAt?: number;
}

/** Médias envoyés par le composeur : `[{ id, alt }]` en JSON. Tout ce qui n'a pas la bonne forme est ignoré ; les doublons aussi. */
function parseMedia(raw: FormDataEntryValue | null): { id: string; alt: string }[] {
  let list: unknown;
  try {
    list = JSON.parse(String(raw ?? '[]'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: { id: string; alt: string }[] = [];
  for (const item of list) {
    const id = (item as { id?: unknown })?.id;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const alt = (item as { alt?: unknown }).alt;
    out.push({ id, alt: typeof alt === 'string' ? alt.slice(0, ALT_MAX) : '' });
    if (out.length >= MAX_MEDIA_PER_POST) break;
  }
  return out;
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
  const firstComment = String(formData.get('firstComment') ?? '').replace(/\r\n/g, '\n').trim();

  const repos = await getRepositories(ctx);
  // Le navigateur envoie les identifiants des médias (et leur texte alternatif) ; `savePost` relit leur type dans la bibliothèque.
  const res = await savePost(repos, t, { content, integrationIds: ids, publishAt, mode, firstComment, media: parseMedia(formData.get('media')) });
  if (!res.ok) return { errors: res.errors };
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

/** « Réessayer » sous un premier commentaire refusé par le réseau : il repart en file, le worker le republie. */
export async function retryFirstCommentAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return;
  const repos = await getRepositories(session.ctx);
  await repos.posts.retryFirstComment(String(formData.get('postId') ?? ''));
  revalidatePath('/app/calendrier');
}
