'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';
import { ALT_MAX } from '@/lib/media/logic';
import { MAX_MEDIA_PER_POST } from '@/lib/media/rules';
import { supportsFirstComment, validatePost, type PostMode } from '@/lib/posts/logic';

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

  // Médias joints : le navigateur envoie les identifiants (et le texte alternatif) ; le type vient de la bibliothèque, jamais du navigateur.
  const requested = parseMedia(formData.get('media'));
  const library = await repos.media.byIds(requested.map((m) => m.id));
  if (library.length !== requested.length) return { errors: [t('app.validation.mediaMissing')] };
  // Le type et les dimensions viennent de la bibliothèque, jamais du navigateur.
  const attached = requested.map((m, i) => ({ id: m.id, kind: library[i]!.kind, alt: m.alt }));
  const checked = requested.map((_, i) => ({ kind: library[i]!.kind, width: library[i]!.width, height: library[i]!.height, name: library[i]!.name }));

  const integrations = await repos.workspace.integrations();
  const chosen = integrations.filter((i) => ids.includes(i.id));
  const inactive = chosen.filter((i) => i.status !== 'active');
  if (inactive.length > 0) {
    return { errors: [t('app.composer.errReconnect', { names: inactive.map((i) => i.name).join(', ') })] };
  }

  const errors = validatePost({ content, networkIds: chosen.map((i) => i.networkId), publishAt, mode, firstComment, media: checked });
  if (errors.length > 0) return { errors: errors.map((e) => errorText(t, e)) };

  const res = await repos.posts.create({
    // Le premier commentaire part avec les canaux qui savent le publier ; les autres reçoivent la publication seule.
    targets: chosen.map((i) => ({ integrationId: i.id, firstComment: firstComment && supportsFirstComment(i.networkId) ? firstComment : null })),
    content,
    media: attached,
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

/** « Réessayer » sous un premier commentaire refusé par le réseau : il repart en file, le worker le republie. */
export async function retryFirstCommentAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return;
  const repos = await getRepositories(session.ctx);
  await repos.posts.retryFirstComment(String(formData.get('postId') ?? ''));
  revalidatePath('/app/calendrier');
}
