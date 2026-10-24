'use server';

import { revalidatePath } from 'next/cache';
import { getT } from '@/i18n/server';
import { loadThread, type LoadedThread } from '@/lib/agent/load';
import { parseSaveRequest } from '@/lib/agent/request';
import { getRepositories, getSession } from '@/lib/data';
import { savePost } from '@/lib/posts/save';

export interface SaveAgentResult {
  /** Une erreur qui concerne toute la demande ; sinon, un résultat par publication. */
  error?: string;
  results: { id: string; ok: boolean; errors: string[] }[];
}

/**
 * Enregistre dans le calendrier les publications que l'agent a préparées, après relecture : en brouillon ou programmées. C'est la seule voie par
 * laquelle l'agent fait écrire quelque chose, et elle repasse par les règles du composeur (`savePost`) avec la session de l'utilisateur.
 * Tout ce qui vient du navigateur est relu : une publication déjà enregistrée ne l'est pas deux fois, et elle ne change pas de canal.
 */
export async function saveAgentPostsAction(raw: unknown): Promise<SaveAgentResult> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') return { error: t('app.agent.errors.forbidden'), results: [] };
  const { ctx } = session;
  if (ctx.org.role === 'viewer') return { error: t('app.composer.viewerNote'), results: [] };

  const req = parseSaveRequest(raw);
  if (!req) return { error: t('app.agent.errors.invalid'), results: [] };

  const repos = await getRepositories(ctx);
  const found = await repos.agent.thread(req.threadId);
  const message = found?.messages.find((m) => m.id === req.messageId && m.role === 'assistant');
  if (!message) return { error: t('app.agent.errors.notFound'), results: [] };

  // Le texte alternatif par défaut d'un média est celui de la bibliothèque, comme dans le composeur.
  const library = new Map((await repos.media.byIds([...new Set(req.items.flatMap((i) => i.mediaIds))])).map((m) => [m.id, m]));
  const results: SaveAgentResult['results'] = [];
  const updates = [];

  for (const item of req.items) {
    const proposal = message.proposals.find((p) => p.id === item.id);
    if (!proposal || proposal.integrationId !== item.integrationId) {
      results.push({ id: item.id, ok: false, errors: [t('app.agent.errors.invalid')] });
      continue;
    }
    if (proposal.status !== 'pending') {
      results.push({ id: item.id, ok: false, errors: [t('app.agent.errors.alreadySaved')] });
      continue;
    }
    const firstComment = (item.firstComment ?? '').replace(/\r\n/g, '\n').trim();
    const saved = await savePost(repos, t, {
      content: item.text, integrationIds: [item.integrationId], publishAt: item.publishAt, mode: req.mode, firstComment,
      media: item.mediaIds.map((id) => ({ id, alt: library.get(id)?.alt ?? '' })),
    });
    results.push({ id: item.id, ok: saved.ok, errors: saved.ok ? [] : saved.errors });
    if (saved.ok) {
      updates.push({ id: item.id, status: req.mode === 'draft' ? ('draft' as const) : ('scheduled' as const), text: item.text.trim(), firstComment: firstComment || null, mediaIds: item.mediaIds, publishAt: item.publishAt });
    }
  }

  if (updates.length > 0) {
    await repos.agent.updateProposals(req.messageId, updates);
    revalidatePath('/app/calendrier');
    revalidatePath('/app/publications');
  }
  return { results };
}

/** Rouvre une conversation de l'historique. */
export async function loadThreadAction(threadId: unknown): Promise<LoadedThread | null> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer' || typeof threadId !== 'string' || !/^[\w-]{1,64}$/.test(threadId)) return null;
  return loadThread(await getRepositories(session.ctx), threadId);
}

export async function deleteThreadAction(threadId: unknown): Promise<boolean> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer' || typeof threadId !== 'string' || !/^[\w-]{1,64}$/.test(threadId)) return false;
  const res = await (await getRepositories(session.ctx)).agent.removeThread(threadId);
  return res.ok;
}
