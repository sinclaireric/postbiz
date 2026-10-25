'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { createLimiter } from '@/lib/ai/rate-limit';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';
import { defaultEmbedder } from '@/lib/kb/embed';
import { indexItem, indexMissing } from '@/lib/kb/indexing';
import { retrieve } from '@/lib/kb/retrieve';
import { KB } from '@/lib/kb/types';
import { normalizeKnowledge, validateKnowledge } from '@/lib/knowledge';

export interface KnowledgeFormState {
  error?: string;
  savedAt?: number;
}

/** Une recherche d'essai : ce que l'IA retrouverait pour cette question, pertinent ou non. */
export type KnowledgeTestResult =
  | {
      ok: true;
      mode: 'hybrid' | 'words';
      found: boolean;
      passages: { id: string; title: string; heading: string | null; text: string; relevant: boolean; similarity: number; termHits: number; termCount: number }[];
    }
  | { ok: false; error: 'forbidden' | 'invalid' | 'rate_limited' };

/** La recherche d'essai appelle le service d'embeddings (facturé, très peu) : limitée par utilisateur. */
const testLimiter = createLimiter(30, 10 * 60_000);

const REVALIDATE = ['/app/connaissances', '/app/calendrier'] as const;
const refresh = () => REVALIDATE.forEach((path) => revalidatePath(path));

/** Le service d'embeddings du serveur ; en démonstration aucune IA n'est appelée, la recherche se fait par les mots. */
const embedderFor = (mode: 'demo' | 'supabase') => (mode === 'demo' ? null : defaultEmbedder());

async function writer() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  return session.ctx.org.role === 'viewer' ? null : session.ctx;
}

/** Crée une fiche, ou modifie celle dont l'identifiant est envoyé (`id`), puis l'indexe. Réservé aux administrateurs et aux membres. */
export async function saveKnowledgeAction(_: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  const t = await getT();
  const ctx = await writer();
  if (!ctx) return { error: t('app.knowledge.viewerNote') };

  const id = String(formData.get('id') ?? '');
  const input = normalizeKnowledge(formData.get('title'), formData.get('content'));
  const repos = await getRepositories(ctx);
  const invalid = validateKnowledge(input, id ? undefined : (await repos.knowledge.list()).length);
  if (invalid) return { error: errorText(t, invalid) };

  const res = id ? await repos.knowledge.update(id, input) : await repos.knowledge.create(input);
  if (!res.ok) return { error: res.error ? errorText(t, res.error) : t('app.knowledge.errSave') };
  const itemId = id || (res as { id?: string }).id;
  // La fiche est enregistrée même si l'indexation échoue : elle est reprise à la prochaine ouverture de la page.
  if (itemId) await indexItem({ knowledge: repos.knowledge, embedder: embedderFor(ctx.mode) }, { id: itemId, ...input }).catch(() => undefined);
  refresh();
  return { savedAt: Date.now() };
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const ctx = await writer();
  if (!ctx) return;
  const repos = await getRepositories(ctx);
  await repos.knowledge.remove(String(formData.get('id') ?? ''));
  refresh();
}

/** Épingle une fiche (toujours envoyée à l'IA) ou la rend consultable seulement (`pinned` vaut « 1 » ou « 0 »). */
export async function setPinnedAction(formData: FormData): Promise<void> {
  const ctx = await writer();
  if (!ctx) return;
  const repos = await getRepositories(ctx);
  await repos.knowledge.setPinned(String(formData.get('id') ?? ''), formData.get('pinned') === '1');
  refresh();
}

/** Réindexe une fiche (bouton « Réindexer »). */
export async function reindexItemAction(formData: FormData): Promise<void> {
  const ctx = await writer();
  if (!ctx) return;
  const repos = await getRepositories(ctx);
  const item = (await repos.knowledge.list()).find((k) => k.id === String(formData.get('id') ?? ''));
  if (item) await indexItem({ knowledge: repos.knowledge, embedder: embedderFor(ctx.mode) }, item).catch(() => undefined);
  refresh();
}

/** Indexe les fiches jamais indexées ou modifiées depuis (la page s'en charge à son ouverture). Rend le nombre de fiches traitées. */
export async function reindexMissingAction(): Promise<number> {
  const ctx = await writer();
  if (!ctx) return 0;
  const repos = await getRepositories(ctx);
  const done = await indexMissing({ knowledge: repos.knowledge, embedder: embedderFor(ctx.mode) }, await repos.knowledge.list()).catch(() => 0);
  if (done > 0) refresh();
  return done;
}

/** « Tester une question » : les passages que l'IA retrouverait dans la base pour cette question. Toutes les fiches sont cherchées, épinglées comprises. */
export async function searchKnowledgeAction(raw: unknown): Promise<KnowledgeTestResult> {
  const ctx = await writer();
  if (!ctx) return { ok: false, error: 'forbidden' };
  const query = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!query || query.length > KB.queryChars) return { ok: false, error: 'invalid' };
  if (!testLimiter.take(ctx.user.id)) return { ok: false, error: 'rate_limited' };

  const repos = await getRepositories(ctx);
  const found = await retrieve({ knowledge: repos.knowledge, embedder: embedderFor(ctx.mode) }, query, { limit: 8 });
  return {
    ok: true, mode: found.mode, found: found.found,
    passages: found.all.map((p) => ({ id: p.chunkId, title: p.title, heading: p.heading, text: p.content.slice(0, 400), relevant: p.relevant, similarity: p.similarity, termHits: p.termHits, termCount: p.termCount })),
  };
}
