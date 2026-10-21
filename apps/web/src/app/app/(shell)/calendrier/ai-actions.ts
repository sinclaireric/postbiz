'use server';

import { getLocale } from '@/i18n/server';
import { LOCALE_META } from '@/i18n/config';
import { aiConfigured, runAssist } from '@/lib/ai/claude';
import { languageName } from '@/lib/ai/prompt';
import { assistLimiter, ideasLimiter } from '@/lib/ai/rate-limit';
import { parseAiRequest } from '@/lib/ai/request';
import type { AiRequest, AiResult } from '@/lib/ai/types';
import { getRepositories, getSession } from '@/lib/data';

const usesKnowledge = (req: AiRequest) => (req.mode === 'ideas' ? req.knowledge : req.useKnowledge);

/**
 * Assistant IA du composeur : rédiger, améliorer, proposer des idées. La demande vient du navigateur (donnée non fiable) :
 * elle est relue et bornée, réservée aux administrateurs et aux membres, et limitée en nombre d'appels par utilisateur.
 */
export async function assistAction(raw: unknown): Promise<AiResult> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer') return { ok: false, error: 'forbidden' };
  if (!aiConfigured()) return { ok: false, error: 'disabled' };

  const req = parseAiRequest(raw);
  if (!req) return { ok: false, error: 'invalid' };
  const { ctx } = session;
  if (!(req.mode === 'ideas' ? ideasLimiter : assistLimiter).take(ctx.user.id)) return { ok: false, error: 'rate_limited' };

  const repos = await getRepositories(ctx);
  const entries = usesKnowledge(req) ? (await repos.knowledge.list()).map(({ title, content }) => ({ title, content })) : [];
  const language = languageName(LOCALE_META[await getLocale()].tag);
  return runAssist(req, { entries, orgName: ctx.org.name, language });
}
