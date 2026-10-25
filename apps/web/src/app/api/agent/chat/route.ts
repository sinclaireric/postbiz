import { getLocale, getT } from '@/i18n/server';
import { LOCALE_META } from '@/i18n/config';
import { languageName } from '@/lib/ai/prompt';
import { runDemoTurn } from '@/lib/agent/demo';
import { attachmentNote, buildHistory, threadTitle } from '@/lib/agent/prompt';
import { agentLimiter, encodeEvent, parseChatRequest } from '@/lib/agent/request';
import { agentConfigured } from '@/lib/agent/config';
import { createGenerationTools } from '@/lib/agent/generation';
import { agentErrorCode, runAgentTurn, sdkAgentClient, type AgentTurnResult } from '@/lib/agent/run';
import { createToolbox } from '@/lib/agent/tools';
import type { AgentErrorCode, AgentEvent } from '@/lib/agent/types';
import { bearerToken, getRepositories, getSession, getSessionForToken } from '@/lib/data';
import { digest } from '@/lib/digest';
import { generationSetup } from '@/lib/agent/setup';

export const dynamic = 'force-dynamic';
/**
 * Une réponse peut enchaîner jusqu'à quatre appels au modèle. 60 secondes : le plafond de tous les forfaits Vercel (un forfait plus large peut le relever,
 * c'est la seule valeur à changer). Une réponse coupée par la plateforme arrive au navigateur comme une erreur, et le message reste dans le champ.
 */
export const maxDuration = 60;

const MAX_BODY = 20_000;
const HEADERS = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' };

/** Même format que la réponse en flux, pour que le navigateur lise un seul format : une ligne d'erreur. */
const failure = (code: AgentErrorCode, status: number) => new Response(encodeEvent({ type: 'error', code }), { status, headers: HEADERS });

/**
 * La conversation avec l'agent. Le navigateur envoie un message (et les canaux cochés) ; la réponse est un flux d'événements, un par ligne : le texte au fil
 * de l'eau, les outils consultés, puis l'échange enregistré. L'agent ne fait que proposer : aucune publication n'est écrite ici (voir `saveAgentPostsAction`).
 * Réservé aux administrateurs et aux membres ; en mode démo, la réponse est simulée et aucun appel n'est fait à l'IA.
 */
export async function POST(request: Request): Promise<Response> {
  // Le navigateur s'identifie par ses cookies ; l'application mobile, par le jeton Supabase de l'utilisateur (en-tête Authorization).
  const token = bearerToken(request.headers.get('authorization'));
  const auth = token ? await getSessionForToken(token) : null;
  const session = auth ? auth.session : await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return failure('forbidden', session.status === 'ready' ? 403 : 401);
  const { ctx } = session;
  const demo = ctx.mode === 'demo';
  if (!demo && !agentConfigured()) return failure('disabled', 503);

  const raw = await request.text();
  let body: unknown;
  try {
    body = raw.length <= MAX_BODY ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const req = parseChatRequest(body);
  if (!req) return failure('invalid', 400);
  if (!agentLimiter.take(ctx.user.id)) return failure('rate_limited', 429);

  const repos = auth?.repos ?? (await getRepositories(ctx));
  const [integrations, knowledge, existing, attached] = await Promise.all([
    repos.workspace.integrations(),
    repos.knowledge.list(),
    req.threadId ? repos.agent.thread(req.threadId) : Promise.resolve(null),
    repos.media.byIds(req.mediaIds),
  ]);
  if (req.threadId && !existing) return failure('not_found', 404);
  if (attached.length !== req.mediaIds.length) return failure('invalid', 400);

  const channels = integrations.filter((i) => req.channelIds.includes(i.id));
  // La langue et les textes se lisent dans les cookies de la requête : avant d'ouvrir le flux, pas pendant.
  const t = await getT();
  const language = languageName(LOCALE_META[await getLocale()].tag);
  const now = new Date();
  const startedAt = Date.now();
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true; // le navigateur est parti
        }
      };

      try {
        const title = req.message || attached[0]?.name || '…';
        const userContent = `${req.message}${attachmentNote(attached)}`.trim();
        let result: AgentTurnResult;
        // La réponse est coupée par la plateforme au bout de `maxDuration` : une image n'est pas lancée si elle risque de ne pas finir avant.
        const { features, deps: generation } = generationSetup({ demo, repos, signal: abort.signal, deadline: startedAt + maxDuration * 1_000 });
        const tools = createGenerationTools(generation);
        if (demo) {
          result = await runDemoTurn({
            t, channels, library: (await repos.media.list({ page: 1, pageSize: 40 })).items, posts: await repos.posts.list(),
            timeZone: req.timeZone, now, emit, newId: () => crypto.randomUUID(),
            generation: tools,
          }, userContent, attached);
        } else {
          result = await runAgentTurn({
            client: sdkAgentClient(), channels, knowledge: knowledge.map(({ title, content }) => ({ title, content })), orgName: ctx.org.name,
            language, timeZone: req.timeZone, now, history: buildHistory(existing?.messages ?? []),
            tools: createToolbox(repos, integrations, req.timeZone, now, tools), features, emit, attached, signal: abort.signal,
            safetyId: await digest(ctx.user.id), cacheKey: await digest(ctx.org.id),
          }, userContent);
          // Seulement des nombres : aucun contenu de publication ni de conversation dans les journaux.
          console.info('[agent] usage', JSON.stringify(result.usage));
        }

        const saved = await repos.agent.saveExchange({
          threadId: req.threadId, title: threadTitle(title),
          user: { text: req.message, mediaIds: req.mediaIds },
          assistant: { text: result.text, proposals: result.proposals, mediaIds: result.images.map((m) => m.id), jobIds: result.jobs.map((j) => j.id) },
        });
        emit(saved ? { type: 'done', ...saved } : { type: 'error', code: 'failed' });
      } catch (error) {
        emit({ type: 'error', code: agentErrorCode(error) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // déjà fermé par le navigateur
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { headers: HEADERS });
}
