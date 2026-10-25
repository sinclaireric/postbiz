import OpenAI from 'openai';
import { fitsLimits, ideasPrompt, improvePrompt, IMPROVE_ACTIONS, knowledgeBlock, newsResearchPrompt, PROPOSALS_PER_REQUEST, PROPOSALS_SCHEMA, IDEAS_SCHEMA, SYSTEM_RULES, writePrompt, type NewsSource, type PromptContext } from './prompt';
import { normalizeIdeas, normalizeProposals, parseJsonText } from './parse';
import type { AiErrorCode, AiRequest, AiResult, KnowledgeEntry } from './types';

type Params = Omit<OpenAI.Responses.ResponseCreateParams, 'stream'>;
type Output = OpenAI.Responses.ResponseOutputItem;

/**
 * Le modèle de l'assistant du composeur : GPT-4.1, d'OpenAI, comme les fonctions de rédaction de Postiz (`openai.service.ts`). `OPENAI_ASSISTANT_MODEL` permet
 * d'en choisir un autre sans toucher au code. Même clé que l'agent (`OPENAI_API_KEY`), côté serveur uniquement.
 */
export const DEFAULT_MODEL = 'gpt-4.1';
export const aiModel = () => process.env.OPENAI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;
/** L'assistant n'est proposé que si le serveur a une clé d'API OpenAI. */
export const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());

/** Ce que l'assistant lit d'une réponse du modèle (un sous-ensemble de la réponse de l'API, pour pouvoir la simuler dans les tests). */
export interface AiResponse {
  status?: string | null;
  output: Output[];
  incomplete_details?: { reason?: string | null } | null;
}

/** Ce dont l'assistant a besoin du SDK : un seul appel, pour pouvoir le remplacer dans les tests. */
export interface AiClient {
  create(params: Params): Promise<AiResponse>;
}

export function sdkClient(): AiClient {
  // Moins que la durée d'une action serveur : un appel qui traîne échoue proprement.
  const client = new OpenAI({ timeout: 50_000, maxRetries: 1 });
  return { create: (params) => client.responses.create({ ...params, stream: false }) };
}

class RefusedError extends Error {}

/** Le texte d'une réponse : les parties « texte » de ses messages, mises bout à bout. */
export function textOf(response: AiResponse): string {
  return response.output.flatMap((item) => (item.type === 'message' ? item.content.flatMap((part) => (part.type === 'output_text' ? [part.text] : [])) : [])).join('');
}

/** Adresses citées par la réponse (une page trouvée par la recherche web et reprise dans le texte). */
export function citationsOf(response: AiResponse): NewsSource[] {
  const found = new Map<string, NewsSource>();
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type !== 'output_text') continue;
      for (const note of part.annotations ?? []) {
        if (note.type === 'url_citation' && note.url && !found.has(note.url)) found.set(note.url, { title: note.title || note.url, url: note.url });
      }
    }
  }
  return [...found.values()];
}

function check(response: AiResponse) {
  const refused = response.output.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'));
  if (response.incomplete_details?.reason === 'content_filter' || (refused && !textOf(response).trim())) throw new RefusedError();
  if (response.status === 'failed' || response.status === 'incomplete') throw new Error('réponse de l’assistant incomplète');
}

/** Règles, puis base de connaissance : le début identique d'une demande à l'autre (mis en cache par OpenAI), tout ce qui change vient après. */
export function instructionsFor(entries: KnowledgeEntry[]): string {
  const knowledge = knowledgeBlock(entries);
  return knowledge ? `${SYSTEM_RULES}\n\n${knowledge}` : SYSTEM_RULES;
}

const MAX_OUTPUT_TOKENS = 8_000;

async function generate(client: AiClient, model: string, entries: KnowledgeEntry[], prompt: string, name: string, schema: Record<string, unknown>, maxTokens: number, safetyId?: string): Promise<unknown> {
  const response = await client.create({
    model,
    instructions: instructionsFor(entries),
    input: prompt,
    text: { format: { type: 'json_schema', name, schema, strict: true } },
    max_output_tokens: maxTokens,
    store: false,
    safety_identifier: safetyId,
  });
  check(response);
  return parseJsonText(textOf(response));
}

/** Recherche web : l'assistant cherche l'actualité et en rend des notes ; les adresses des pages citées servent à contrôler les sources reprises ensuite. */
async function researchNews(client: AiClient, model: string, entries: KnowledgeEntry[], prompt: string, safetyId?: string): Promise<{ brief: string; sources: NewsSource[] }> {
  const response = await client.create({
    model,
    instructions: instructionsFor(entries),
    input: prompt,
    tools: [{ type: 'web_search' }],
    // Sans recherche, il n'y aurait pas de source : on exige l'outil.
    tool_choice: 'required',
    max_output_tokens: 6_000,
    store: false,
    safety_identifier: safetyId,
  });
  check(response);
  return { brief: textOf(response).trim(), sources: citationsOf(response) };
}

export interface AssistDeps {
  entries: KnowledgeEntry[];
  orgName: string;
  /** Langue d'écriture, en anglais (« French »). */
  language: string;
  client?: AiClient;
  model?: string;
  now?: Date;
  /** Identifiant de l'utilisateur, déjà haché : transmis à OpenAI pour repérer un abus sans lui donner l'identité de la personne. */
  safetyId?: string;
}

/** Exécute une demande de l'assistant et renvoie un résultat prêt à afficher, jamais une exception. */
export async function runAssist(req: AiRequest, deps: AssistDeps): Promise<AiResult> {
  const client = deps.client ?? sdkClient();
  const model = deps.model ?? aiModel();
  const ctx: PromptContext = { orgName: deps.orgName, language: deps.language, today: (deps.now ?? new Date()).toISOString().slice(0, 10) };
  try {
    if (req.mode === 'write') {
      const entries = req.useKnowledge ? deps.entries : [];
      const raw = await generate(client, model, entries, writePrompt(ctx, req), 'proposals', PROPOSALS_SCHEMA, MAX_OUTPUT_TOKENS, deps.safetyId);
      const proposals = normalizeProposals(raw, fitsLimits(req.networkIds), PROPOSALS_PER_REQUEST);
      return proposals.length > 0 ? { ok: true, mode: 'write', proposals } : { ok: false, error: 'empty' };
    }
    if (req.mode === 'improve') {
      const entries = req.useKnowledge ? deps.entries : [];
      const raw = await generate(client, model, entries, improvePrompt(ctx, req), 'proposals', PROPOSALS_SCHEMA, MAX_OUTPUT_TOKENS, deps.safetyId);
      const proposals = normalizeProposals(raw, fitsLimits(req.networkIds), IMPROVE_ACTIONS[req.action].proposals);
      return proposals.length > 0 ? { ok: true, mode: 'improve', proposals } : { ok: false, error: 'empty' };
    }

    const entries = req.knowledge ? deps.entries : [];
    // Sans thème ni base de connaissance, rien ne dit de quoi parler : la demande n'a pas de sens.
    if (!req.theme && entries.length === 0) return { ok: false, error: 'invalid' };
    const news = req.news ? await researchNews(client, model, entries, newsResearchPrompt(ctx, { theme: req.theme, hasKnowledge: entries.length > 0 }), deps.safetyId) : null;
    if (req.news && !req.knowledge && (!news || news.sources.length === 0)) return { ok: false, error: 'empty' };
    const raw = await generate(client, model, entries, ideasPrompt(ctx, { theme: req.theme, tone: req.tone, networkIds: req.networkIds, knowledge: entries.length > 0 }, news && news.sources.length > 0 ? news : null), 'ideas', IDEAS_SCHEMA, 12_000, deps.safetyId);
    const ideas = normalizeIdeas(raw, fitsLimits(req.networkIds), news?.sources ?? [], news !== null, entries.length > 0);
    return ideas.length > 0 ? { ok: true, mode: 'ideas', ideas } : { ok: false, error: 'empty' };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

function errorCode(error: unknown): AiErrorCode {
  if (error instanceof RefusedError) return 'refused';
  // Quota épuisé (compte sans crédit) : l'assistant n'est pas utilisable, ce n'est pas une rafale de demandes.
  if (error instanceof OpenAI.RateLimitError) return error.code === 'insufficient_quota' ? 'disabled' : 'rate_limited';
  // Clé absente, invalide ou sans droit : l'assistant n'est pas utilisable, ce n'est pas une panne passagère.
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return 'disabled';
  // Le détail reste dans les journaux du serveur : aucun contenu de publication n'y est écrit.
  console.error('[assistant IA]', error instanceof OpenAI.APIError ? `${error.status} ${String(error.message).slice(0, 200)}` : error instanceof Error ? error.name : 'erreur inconnue');
  return 'failed';
}
