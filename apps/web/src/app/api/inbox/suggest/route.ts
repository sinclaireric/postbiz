import { getT } from '@/i18n/server';
import { aiConfigured } from '@/lib/ai/assistant';
import { bearerToken, getRepositories, getSession, getSessionForToken } from '@/lib/data';
import { digest } from '@/lib/digest';
import { suggestLimiter, suggestionsPerDay } from '@/lib/inbox/limits';
import { suggestForConversation, type SuggestErrorCode } from '@/lib/inbox/suggest';
import { defaultEmbedder } from '@/lib/kb/embed';

export const dynamic = 'force-dynamic';
/** Une recherche dans la base et un appel au modèle : bien moins que les 60 secondes du plafond des forfaits. */
export const maxDuration = 30;

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const MAX_BODY = 2_000;
const ID = /^[\w-]{1,64}$/;

const STATUS: Record<SuggestErrorCode, number> = { disabled: 503, forbidden: 403, invalid: 400, rate_limited: 429, refused: 422, failed: 502, not_found: 404, window_closed: 409 };
const failure = (error: SuggestErrorCode, status: number = STATUS[error]) => new Response(JSON.stringify({ error }), { status, headers: HEADERS });

/**
 * Prépare un brouillon de réponse à une conversation de l'inbox, d'après la base de connaissance. L'IA n'envoie rien : le brouillon est relu et envoyé par une personne.
 * Réservé aux administrateurs et aux membres. Cookies ou jeton Bearer (l'application mobile), comme l'agent. En démonstration, la réponse est simulée.
 */
export async function POST(request: Request): Promise<Response> {
  const token = bearerToken(request.headers.get('authorization'));
  const auth = token ? await getSessionForToken(token) : null;
  const session = auth ? auth.session : await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return failure('forbidden', session.status === 'ready' ? 403 : 401);
  const { ctx } = session;
  const demo = ctx.mode === 'demo';
  if (!demo && !aiConfigured()) return failure('disabled');
  const dailyLimit = suggestionsPerDay();
  if (dailyLimit === 0) return failure('disabled');

  const raw = await request.text();
  let conversationId: unknown;
  try {
    conversationId = raw.length <= MAX_BODY ? (JSON.parse(raw) as { conversationId?: unknown } | null)?.conversationId : null;
  } catch {
    conversationId = null;
  }
  if (typeof conversationId !== 'string' || !ID.test(conversationId)) return failure('invalid');
  if (!suggestLimiter.take(ctx.user.id)) return failure('rate_limited');

  const repos = auth?.repos ?? (await getRepositories(ctx));
  const result = await suggestForConversation({
    repos, orgName: ctx.org.name, userId: ctx.user.id, embedder: demo ? null : defaultEmbedder(), dailyLimit, signal: request.signal,
    demo: demo ? { t: await getT() } : undefined, safetyId: demo ? undefined : await digest(ctx.user.id),
  }, conversationId);
  return result.ok ? new Response(JSON.stringify({ suggestion: result.suggestion }), { headers: HEADERS }) : failure(result.error);
}
