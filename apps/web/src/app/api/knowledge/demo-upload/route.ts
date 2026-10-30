import { revalidatePath } from 'next/cache';
import { SOURCE_LIMITS, titleFromFileName } from '@postbiz/kb';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (body: { ok: true } | { ok: false; error: string }, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

/**
 * L'envoi d'un document en mode démonstration seulement : sans stockage ni worker, le fichier est lu tout de suite par ce serveur (même code que le worker).
 * Partout ailleurs, le navigateur dépose le fichier dans le stockage de l'organisation et appelle `registerDocumentAction`.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (session.status !== 'ready') return reply({ ok: false, error: 'forbidden' }, 401);
  const { ctx } = session;
  if (ctx.mode !== 'demo') return reply({ ok: false, error: 'not_found' }, 404);
  const t = await getT();
  if (ctx.org.role === 'viewer') return reply({ ok: false, error: t('app.knowledge.viewerNote') }, 403);

  const tooLarge = () => reply({ ok: false, error: t('app.knowledgePage.errors.fileTooLarge', { max: Math.round(SOURCE_LIMITS.fileBytes / 1_048_576) }) }, 413);
  // Un corps annoncé bien plus gros que la limite n'est même pas lu (le serveur le couperait vers 10 Mo, et on répondrait « fichier introuvable »).
  if (Number(request.headers.get('content-length')) > SOURCE_LIMITS.fileBytes + 256 * 1024) return tooLarge();

  let file: unknown;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return reply({ ok: false, error: t('app.knowledgePage.errors.fileMissing') }, 400);
  }
  if (!(file instanceof File) || file.size === 0) return reply({ ok: false, error: t('app.knowledgePage.errors.fileMissing') }, 400);
  if (file.size > SOURCE_LIMITS.fileBytes) return tooLarge();

  const repos = await getRepositories(ctx);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await repos.knowledge.addFile({ path: `${ctx.org.id}/${file.name.replace(/[/\\]/g, '_')}`, title: titleFromFileName(file.name), size: bytes.length, bytes });
  if (!res.ok) return reply({ ok: false, error: res.error ? errorText(t, res.error) : t('app.knowledge.errSave') }, 400);
  revalidatePath('/app/connaissances');
  return reply({ ok: true });
}
