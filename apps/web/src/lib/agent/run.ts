import OpenAI from 'openai';
import { knowledgeBlock } from '@/lib/ai/prompt';
import type { KnowledgeEntry } from '@/lib/ai/types';
import type { IntegrationItem, MediaItem } from '@/lib/data/types';
import { agentConfigured, agentModel, DEFAULT_AGENT_MODEL } from './config';
import { toAgentMedia } from './media';
import { mediaIdsOf, parseProposeInput } from './proposal';
import { AGENT_RULES, AGENT_TOOLS_DEFS, sessionBlock, type ModelTurn } from './prompt';
import { AGENT_LIMITS, AGENT_TOOLS, type AgentErrorCode, type AgentEvent, type AgentMedia, type AgentProposal, type AgentToolName } from './types';

type Input = OpenAI.Responses.ResponseInputItem;
type Output = OpenAI.Responses.ResponseOutputItem;
type Params = Omit<OpenAI.Responses.ResponseCreateParams, 'stream'>;

export { agentConfigured, agentModel, DEFAULT_AGENT_MODEL };

/** Ce que la boucle lit d'une réponse du modèle (un sous-ensemble de la réponse de l'API, pour pouvoir la simuler dans les tests). */
export interface AgentResponse {
  status?: string | null;
  output: Output[];
  usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } | null } | null;
  incomplete_details?: { reason?: string | null } | null;
}

/** Ce dont l'agent a besoin du SDK : un appel en flux, pour pouvoir le remplacer dans les tests. */
export interface AgentClient {
  /** Appelle le modèle ; `onText` reçoit chaque fragment de texte dès qu'il arrive ; rend la réponse complète. */
  stream(params: Params, onText: (delta: string) => void, signal?: AbortSignal): Promise<AgentResponse>;
}

export function sdkAgentClient(): AgentClient {
  // Moins que la durée maximale de la route (60 s) : un appel qui traîne échoue proprement au lieu d'être coupé par la plateforme.
  const client = new OpenAI({ timeout: 50_000, maxRetries: 1 });
  return {
    async stream(params, onText, signal) {
      const stream = client.responses.stream(params, { signal });
      stream.on('response.output_text.delta', (event) => onText(event.delta));
      return stream.finalResponse();
    },
  };
}

export class AgentRefusedError extends Error {}
export class AgentEmptyError extends Error {}

const MAX_OUTPUT_TOKENS = 16_000;

/** Ce que l'agent peut consulter. Chaque méthode passe par les dépôts de données de l'utilisateur connecté : la RLS reste la seule autorité. */
export interface AgentToolbox {
  /** Publications du calendrier entre deux dates locales, déjà mises en forme pour le modèle. */
  listPosts(args: { from?: string; to?: string; channelId?: string }): Promise<unknown>;
  /** Médias de la bibliothèque (18 au plus), déjà mis en forme pour le modèle. */
  listMedia(args: { search?: string }): Promise<{ items: MediaItem[]; text: unknown }>;
  mediaByIds(ids: string[]): Promise<MediaItem[]>;
}

export interface AgentTurnDeps {
  client: AgentClient;
  model?: string;
  channels: readonly IntegrationItem[];
  knowledge: KnowledgeEntry[];
  orgName: string;
  /** Langue de l'application, en anglais (« French »). */
  language: string;
  timeZone: string;
  now?: Date;
  history: ModelTurn[];
  tools: AgentToolbox;
  emit: (event: AgentEvent) => void;
  newId?: () => string;
  /** Médias que l'utilisateur vient de joindre : ils sont connus de l'agent dès le premier appel. */
  attached?: readonly MediaItem[];
  /** Interrompt la réponse (l'utilisateur a fermé la page ou cliqué sur « Arrêter ») : l'appel en cours au modèle est annulé. */
  signal?: AbortSignal;
  /** Identifiant de l'utilisateur, déjà haché : transmis à OpenAI pour repérer un abus sans lui donner l'identité de la personne. */
  safetyId?: string;
  /** Identifiant de l'organisation, déjà haché : regroupe les demandes qui partagent le même début (règles, base de connaissance) pour le cache de prompt. */
  cacheKey?: string;
}

export interface AgentUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Jetons d'entrée servis par le cache de prompt (facturés dix fois moins). */
  cachedTokens: number;
}

export interface AgentTurnResult {
  text: string;
  proposals: AgentProposal[];
  media: AgentMedia[];
  usage: AgentUsage;
}

/** Règles, puis base de connaissance : le début identique d'une demande à l'autre, que le cache de prompt réutilise. La date et les canaux viennent après. */
export function instructionsFor(knowledge: KnowledgeEntry[]): string {
  const block = knowledgeBlock(knowledge);
  return block ? `${AGENT_RULES}\n\n${block}` : AGENT_RULES;
}

const isTool = (name: string): name is AgentToolName => (AGENT_TOOLS as readonly string[]).includes(name);
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Un tour de conversation : l'agent lit l'historique et la demande, consulte au besoin les publications et les médias, puis prépare des
 * publications. La boucle s'arrête dès que des publications valides sont préparées (pas d'appel de clôture : la phrase d'introduction
 * suffit), ou au bout de `toolTurns` appels au modèle. Aucune écriture : l'agent ne fait que proposer.
 */
export async function runAgentTurn(deps: AgentTurnDeps, userContent: string): Promise<AgentTurnResult> {
  const now = deps.now ?? new Date();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const model = deps.model ?? agentModel();
  const known = new Map<string, MediaItem>((deps.attached ?? []).map((m) => [m.id, m]));
  const usage: AgentUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const instructions = instructionsFor(deps.knowledge);
  const context = sessionBlock({ orgName: deps.orgName, language: deps.language, timeZone: deps.timeZone, now, channels: deps.channels });
  // La date et les canaux viennent juste avant la demande, après l'historique : le début de la requête reste identique d'un message à l'autre.
  const input: Input[] = [...deps.history.map((t) => ({ role: t.role, content: t.content })), { role: 'developer', content: context }, { role: 'user', content: userContent }];

  let reply = '';
  let proposals: AgentProposal[] = [];
  let proposalMedia: AgentMedia[] = [];

  for (let turn = 0; turn < AGENT_LIMITS.toolTurns; turn++) {
    deps.signal?.throwIfAborted();
    let turnText = '';
    const response = await deps.client.stream(
      {
        model, instructions, input, tools: AGENT_TOOLS_DEFS, reasoning: { effort: 'low' }, max_output_tokens: MAX_OUTPUT_TOKENS,
        // Rien n'est gardé chez OpenAI : l'historique est rejoué par l'application, le raisonnement chiffré compris (voir `input.push` plus bas).
        store: false, safety_identifier: deps.safetyId, prompt_cache_key: deps.cacheKey,
      },
      (delta) => {
        // Une seconde phrase après un appel d'outil ne se colle pas à la première.
        if (!turnText && reply) deps.emit({ type: 'text', delta: '\n\n' });
        turnText += delta;
        deps.emit({ type: 'text', delta });
      },
      deps.signal,
    );
    usage.calls++;
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    usage.cachedTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;

    const calls = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call');
    const refused = response.output.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'));
    if (response.status === 'failed') throw new Error('réponse de l’agent en échec');
    if (response.incomplete_details?.reason === 'content_filter' || (refused && calls.length === 0 && !turnText.trim())) throw new AgentRefusedError();
    // Un appel d'outil coupé par la limite de jetons serait lu de travers : on ne l'exécute pas.
    if (response.status === 'incomplete') throw new Error('réponse de l’agent tronquée');
    if (turnText.trim()) reply = reply ? `${reply}\n\n${turnText.trim()}` : turnText.trim();
    if (calls.length === 0) break;

    // Tout ce que le modèle a produit (raisonnement chiffré, appels, texte) est renvoyé tel quel, suivi des résultats des outils.
    input.push(...(response.output as Input[]));
    const results: Input[] = [];
    let delivered = false;
    for (const call of calls) {
      const output = (value: unknown) => results.push({ type: 'function_call_output', call_id: call.call_id, output: typeof value === 'string' ? value : JSON.stringify(value) });
      if (!isTool(call.name)) {
        output(`Unknown tool ${call.name}.`);
        continue;
      }
      const args = parseArguments(call.arguments);
      if (!args) {
        output('The arguments are not a valid JSON object. Call the tool again with valid JSON.');
        continue;
      }
      deps.emit({ type: 'tool', name: call.name });

      if (call.name === 'list_posts') {
        output(await deps.tools.listPosts({ from: text(args.from, 10), to: text(args.to, 10), channelId: text(args.channel_id, 64) }));
      } else if (call.name === 'list_media') {
        const { items, text: data } = await deps.tools.listMedia({ search: text(args.search, 80) });
        for (const m of items) known.set(m.id, m);
        output(data);
      } else {
        const wanted = mediaIdsOf(args).filter((id) => !known.has(id));
        if (wanted.length > 0) for (const m of await deps.tools.mediaByIds(wanted)) known.set(m.id, m);
        const parsed = parseProposeInput(args, { channels: deps.channels, media: known, timeZone: deps.timeZone, now, newId });
        if (!parsed.ok) {
          output(`Nothing was prepared. Fix every issue, then call propose_posts again with the complete list:\n${parsed.issues.map((i) => `- ${i}`).join('\n')}`);
          continue;
        }
        proposals = parsed.proposals;
        const ids = [...new Set(proposals.flatMap((p) => p.mediaIds))];
        proposalMedia = ids.flatMap((id) => (known.has(id) ? [toAgentMedia(known.get(id)!)] : []));
        delivered = true;
        output(`Prepared ${proposals.length} post(s); the app shows them to the user.`);
      }
    }
    if (delivered) break;
    input.push(...results);
  }

  if (!reply && proposals.length === 0) throw new AgentEmptyError();
  if (proposals.length > 0) deps.emit({ type: 'proposals', proposals, media: proposalMedia });
  return { text: reply, proposals, media: proposalMedia, usage };
}

/** Traduit une erreur du SDK ou de la boucle en code destiné à l'utilisateur ; le détail reste dans les journaux, sans aucun contenu de publication. */
export function agentErrorCode(error: unknown): AgentErrorCode {
  if (error instanceof OpenAI.APIUserAbortError || (error instanceof DOMException && error.name === 'AbortError')) return 'failed';
  if (error instanceof AgentRefusedError) return 'refused';
  if (error instanceof AgentEmptyError) return 'empty';
  // Quota épuisé (compte sans crédit) : l'agent n'est pas utilisable, ce n'est pas une rafale de demandes.
  if (error instanceof OpenAI.RateLimitError) return error.code === 'insufficient_quota' ? 'disabled' : 'rate_limited';
  // Clé absente, invalide ou sans droit : idem.
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return 'disabled';
  console.error('[agent]', error instanceof OpenAI.APIError ? `${error.status} ${String(error.message).slice(0, 200)}` : error instanceof Error ? error.name : 'erreur inconnue');
  return 'failed';
}
