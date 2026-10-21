import Anthropic from '@anthropic-ai/sdk';
import { fitsLimits, ideasPrompt, improvePrompt, IMPROVE_ACTIONS, knowledgeBlock, newsResearchPrompt, PROPOSALS_PER_REQUEST, PROPOSALS_SCHEMA, IDEAS_SCHEMA, SYSTEM_RULES, writePrompt, type NewsSource, type PromptContext } from './prompt';
import { normalizeIdeas, normalizeProposals, parseJsonText } from './parse';
import type { AiAction, AiErrorCode, AiRequest, AiResult, KnowledgeEntry } from './types';

/** Modèle par défaut ; ANTHROPIC_MODEL permet d'en choisir un autre (plus rapide ou moins cher) sans toucher au code. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const aiModel = () => process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
/** L'assistant n'est proposé que si le serveur a une clé d'API Anthropic. */
export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
/** Ce dont l'assistant a besoin du SDK : un seul appel, pour pouvoir le remplacer dans les tests. */
export interface AiClient {
  create(params: Params): Promise<Message>;
}

export function sdkClient(): AiClient {
  const client = new Anthropic();
  return { create: (params) => client.beta.messages.create(params) };
}

class RefusedError extends Error {}

/** Repli automatique sur un autre modèle si le premier refuse la demande pour une raison de politique d'usage (côté serveur Anthropic). */
const FALLBACK: Pick<Params, 'betas' | 'fallbacks'> = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

type Effort = 'low' | 'medium';
const textOf = (message: Message) => message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');

function systemBlocks(entries: KnowledgeEntry[]): Anthropic.Beta.Messages.BetaTextBlockParam[] {
  const blocks: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: 'text', text: SYSTEM_RULES }];
  const knowledge = knowledgeBlock(entries);
  // Règles + base de connaissance forment le début identique d'une demande à l'autre : mis en cache.
  if (knowledge) blocks.push({ type: 'text', text: knowledge, cache_control: { type: 'ephemeral' } });
  return blocks;
}

async function generate(client: AiClient, model: string, entries: KnowledgeEntry[], prompt: string, schema: Record<string, unknown>, effort: Effort, maxTokens: number): Promise<unknown> {
  const message = await client.create({
    model,
    max_tokens: maxTokens,
    ...FALLBACK,
    system: systemBlocks(entries),
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (message.stop_reason === 'refusal') throw new RefusedError();
  return parseJsonText(textOf(message));
}

const MAX_RESEARCH_TURNS = 4;

/** Recherche web : l'assistant cherche l'actualité et en rend des notes ; les adresses des pages trouvées servent à contrôler les sources citées ensuite. */
async function researchNews(client: AiClient, model: string, entries: KnowledgeEntry[], prompt: string): Promise<{ brief: string; sources: NewsSource[] }> {
  let messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  const sources = new Map<string, NewsSource>();
  let brief = '';
  for (let turn = 0; turn < MAX_RESEARCH_TURNS; turn++) {
    const message = await client.create({
      model,
      max_tokens: 6_000,
      ...FALLBACK,
      system: systemBlocks(entries),
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      output_config: { effort: 'low' },
      messages,
    });
    if (message.stop_reason === 'refusal') throw new RefusedError();
    for (const block of message.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const hit of block.content) if (hit.url && !sources.has(hit.url)) sources.set(hit.url, { title: hit.title || hit.url, url: hit.url });
      }
    }
    brief = textOf(message).trim() || brief;
    // La recherche a atteint sa limite d'étapes côté serveur : on la laisse reprendre là où elle s'est arrêtée.
    if (message.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: message.content as Anthropic.Beta.Messages.BetaContentBlockParam[] }];
  }
  return { brief, sources: [...sources.values()] };
}

const EFFORT: Record<AiAction, Effort> = { rewrite: 'medium', shorten: 'medium', expand: 'medium', tone: 'medium', fix: 'low', hashtags: 'low', adapt: 'medium' };

export interface AssistDeps {
  entries: KnowledgeEntry[];
  orgName: string;
  /** Langue d'écriture, en anglais (« French »). */
  language: string;
  client?: AiClient;
  model?: string;
  now?: Date;
}

/** Exécute une demande de l'assistant et renvoie un résultat prêt à afficher, jamais une exception. */
export async function runAssist(req: AiRequest, deps: AssistDeps): Promise<AiResult> {
  const client = deps.client ?? sdkClient();
  const model = deps.model ?? aiModel();
  const ctx: PromptContext = { orgName: deps.orgName, language: deps.language, today: (deps.now ?? new Date()).toISOString().slice(0, 10) };
  try {
    if (req.mode === 'write') {
      const entries = req.useKnowledge ? deps.entries : [];
      const raw = await generate(client, model, entries, writePrompt(ctx, req), PROPOSALS_SCHEMA, 'medium', 8_000);
      const proposals = normalizeProposals(raw, fitsLimits(req.networkIds), PROPOSALS_PER_REQUEST);
      return proposals.length > 0 ? { ok: true, mode: 'write', proposals } : { ok: false, error: 'empty' };
    }
    if (req.mode === 'improve') {
      const entries = req.useKnowledge ? deps.entries : [];
      const raw = await generate(client, model, entries, improvePrompt(ctx, req), PROPOSALS_SCHEMA, EFFORT[req.action], 8_000);
      const proposals = normalizeProposals(raw, fitsLimits(req.networkIds), IMPROVE_ACTIONS[req.action].proposals);
      return proposals.length > 0 ? { ok: true, mode: 'improve', proposals } : { ok: false, error: 'empty' };
    }

    const entries = req.knowledge ? deps.entries : [];
    // Sans thème ni base de connaissance, rien ne dit de quoi parler : la demande n'a pas de sens.
    if (!req.theme && entries.length === 0) return { ok: false, error: 'invalid' };
    const news = req.news ? await researchNews(client, model, entries, newsResearchPrompt(ctx, { theme: req.theme, hasKnowledge: entries.length > 0 })) : null;
    if (req.news && !req.knowledge && (!news || news.sources.length === 0)) return { ok: false, error: 'empty' };
    const raw = await generate(client, model, entries, ideasPrompt(ctx, { theme: req.theme, tone: req.tone, networkIds: req.networkIds, knowledge: entries.length > 0 }, news && news.sources.length > 0 ? news : null), IDEAS_SCHEMA, 'medium', 12_000);
    const ideas = normalizeIdeas(raw, fitsLimits(req.networkIds), news?.sources ?? [], news !== null, entries.length > 0);
    return ideas.length > 0 ? { ok: true, mode: 'ideas', ideas } : { ok: false, error: 'empty' };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

function errorCode(error: unknown): AiErrorCode {
  if (error instanceof RefusedError) return 'refused';
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  // Clé absente, invalide ou sans droit : l'assistant n'est pas utilisable, ce n'est pas une panne passagère.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return 'disabled';
  // Le détail reste dans les journaux du serveur : aucun contenu de publication n'y est écrit.
  console.error('[assistant IA]', error instanceof Anthropic.APIError ? `${error.status} ${error.message.slice(0, 200)}` : error instanceof Error ? error.name : 'erreur inconnue');
  return 'failed';
}
