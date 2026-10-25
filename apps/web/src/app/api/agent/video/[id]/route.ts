import { advanceVideoJob } from '@/lib/agent/generation';
import { toAgentMedia } from '@/lib/agent/media';
import { videoPollLimiter } from '@/lib/agent/request';
import { generationSetup } from '@/lib/agent/setup';
import type { AgentErrorCode, VideoJobResponse } from '@/lib/agent/types';
import { bearerToken, getRepositories, getSession, getSessionForToken } from '@/lib/data';

export const dynamic = 'force-dynamic';
/** Enregistrer une vidéo terminée (téléchargement, puis envoi dans le stockage) peut durer un moment : 60 secondes, le plafond de tous les forfaits Vercel. */
export const maxDuration = 60;

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const failure = (error: AgentErrorCode, status: number) => new Response(JSON.stringify({ error }), { status, headers: HEADERS });

/**
 * L'état d'une vidéo lancée par l'agent. L'interroger la fait avancer : quand le fournisseur a terminé, cette requête télécharge la vidéo et la range
 * dans la médiathèque (une seule requête le fait, les autres rendent l'état courant). Une tâche est privée à son auteur (RLS). Cookies ou jeton Bearer, comme le chat.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const token = bearerToken(request.headers.get('authorization'));
  const auth = token ? await getSessionForToken(token) : null;
  const session = auth ? auth.session : await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return failure('forbidden', session.status === 'ready' ? 403 : 401);
  const { ctx } = session;

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return failure('invalid', 400);
  if (!videoPollLimiter.take(ctx.user.id)) return failure('rate_limited', 429);

  const repos = auth?.repos ?? (await getRepositories(ctx));
  const { deps } = generationSetup({ demo: ctx.mode === 'demo', repos, signal: request.signal });
  const result = await advanceVideoJob(deps, id);
  if (!result.ok) return failure('not_found', 404);
  const body: VideoJobResponse = { job: result.job, media: result.item ? toAgentMedia(result.item) : null, url: result.item?.url ?? null };
  return new Response(JSON.stringify(body), { headers: HEADERS });
}
