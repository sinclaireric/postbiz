'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';
import { normalizeKnowledge, validateKnowledge } from '@/lib/knowledge';

export interface KnowledgeFormState {
  error?: string;
  savedAt?: number;
}

/** Crée une fiche, ou modifie celle dont l'identifiant est envoyé (`id`). Réservé aux administrateurs et aux membres. */
export async function saveKnowledgeAction(_: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  if (session.ctx.org.role === 'viewer') return { error: t('app.knowledge.viewerNote') };

  const id = String(formData.get('id') ?? '');
  const input = normalizeKnowledge(formData.get('title'), formData.get('content'));
  const repos = await getRepositories(session.ctx);
  const invalid = validateKnowledge(input, id ? undefined : (await repos.knowledge.list()).length);
  if (invalid) return { error: errorText(t, invalid) };

  const res = id ? await repos.knowledge.update(id, input) : await repos.knowledge.create(input);
  if (!res.ok) return { error: res.error ? errorText(t, res.error) : t('app.knowledge.errSave') };
  revalidatePath('/app/calendrier');
  return { savedAt: Date.now() };
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return;
  const repos = await getRepositories(session.ctx);
  await repos.knowledge.remove(String(formData.get('id') ?? ''));
  revalidatePath('/app/calendrier');
}
