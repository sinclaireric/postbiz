import { aiModel, check, errorCode, sdkClient, textOf, type AiClient } from '@/lib/ai/assistant';
import { parseJsonText } from '@/lib/ai/parse';
import { knowledgeBlock } from '@/lib/ai/prompt';
import type { T } from '@/i18n/types';
import type { Repositories } from '@/lib/data/types';
import type { Embedder } from '@/lib/kb/embed';
import { passagesBlock } from '@/lib/kb/format';
import { NOTHING, retrieve, type Retrieval } from '@/lib/kb/retrieve';
import { splitKnowledge } from '@/lib/kb/split';
import { queryTerms } from '@/lib/kb/terms';
import { networkName } from '@/lib/networks';
import { replyWindow } from './logic';
import { fitReply, sameReply, SUGGEST_MAX_CHARS, SUGGEST_HISTORY, SUGGEST_RULES, SUGGEST_SCHEMA, suggestPrompt, type SuggestTurn } from './suggest-prompt';
import type { ConversationDetail } from './types';

export type SuggestErrorCode = 'disabled' | 'forbidden' | 'invalid' | 'rate_limited' | 'refused' | 'failed' | 'not_found' | 'window_closed';

/** Ce que la suggestion rend à l'écran : le brouillon, ce qui le fonde, et si une personne doit s'en charger. */
export interface Suggestion {
  /** Identifiant de la suggestion gardée en base (vide si elle n'a pas pu l'être) : sert à savoir ce que l'utilisateur en a fait. */
  id: string;
  reply: string;
  /** Vrai : la réponse s'appuie sur la base de connaissance. Faux : rien n'y répondait, le brouillon n'est qu'une réponse d'attente. */
  grounded: boolean;
  needsHuman: boolean;
  /** Titres des fiches dont viennent les passages retrouvés. */
  sources: string[];
}

export type SuggestResult = { ok: true; suggestion: Suggestion } | { ok: false; error: SuggestErrorCode };

export interface SuggestDeps {
  repos: Pick<Repositories, 'inbox' | 'knowledge' | 'suggestions'>;
  orgName: string;
  userId: string;
  embedder: Embedder | null;
  /** Suggestions par jour et par organisation (chacune est facturée). */
  dailyLimit: number;
  /** Mode démo : texte simulé avec la langue de l'application, aucune IA appelée. */
  demo?: { t: T };
  client?: AiClient;
  model?: string;
  now?: Date;
  signal?: AbortSignal;
  /** Identifiant de l'utilisateur, déjà haché : transmis à OpenAI pour repérer un abus sans lui donner l'identité de la personne. */
  safetyId?: string;
}

/** Les derniers messages de la conversation, du plus ancien au plus récent, sans ceux qui n'ont pas de texte (pièce jointe seule). */
export function turnsOf(c: Pick<ConversationDetail, 'messages'>): SuggestTurn[] {
  return [...c.messages]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((m): SuggestTurn[] => (m.body?.trim() ? [{ role: m.direction === 'in' ? 'customer' : 'business', text: m.body.trim() }] : []))
    .slice(-SUGGEST_HISTORY.messages);
}

/** Ce qu'on demande à la base : le dernier message du client, avec le message d'avant (« et le dimanche ? » ne veut rien dire seul). */
export function suggestQuery(turns: SuggestTurn[]): string {
  const last = turns.map((t) => t.role).lastIndexOf('customer');
  if (last < 0) return '';
  return [turns[last - 1]?.text, turns[last]!.text].filter(Boolean).join(' ');
}

/** Une réponse vient d'être envoyée à partir d'une suggestion : on garde si elle est partie telle quelle ou modifiée. Ne lève jamais. */
export async function settleSuggestion(repos: Pick<Repositories, 'suggestions'>, suggestionId: string, sent: string): Promise<void> {
  try {
    const draft = await repos.suggestions.reply(suggestionId);
    if (draft !== null) await repos.suggestions.settle(suggestionId, sameReply(draft, sent) ? 'sent' : 'edited');
  } catch {
    // La mesure n'est pas essentielle : un échec ne doit pas gêner l'envoi.
  }
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Deux mots se correspondent s'ils sont égaux ou, à partir de cinq lettres, s'ils commencent pareil (« livrez » et « livraison »). */
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4));

/** Les une ou deux phrases du passage qui contiennent le plus de mots de la question, dans l'ordre du passage, sous `max` signes ; sans mot en commun, la première phrase. */
export function bestSentences(content: string, terms: string[], max = 240): string {
  const sentences = content.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const scored = sentences.map((text, index) => ({ text, index, score: terms.filter((t) => wordsOf(text).some((w) => sameWord(t, w))).length }));
  const picked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index).filter((s, i) => i === 0 || (s.score > 0 && s.score >= scored.reduce((m, x) => Math.max(m, x.score), 0) - 1)).slice(0, 2).sort((a, b) => a.index - b.index);
  const out = picked.map((s) => s.text).join(' ');
  return out.length <= max ? out : `${out.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** La suggestion du mode démo : les phrases du meilleur passage qui répondent à la question, mises dans une phrase d'accueil. Rien n'est inventé, aucune IA n'est appelée. */
function demoReply(t: T, name: string, found: Retrieval, terms: string[]): { reply: string; grounded: boolean } {
  const best = found.passages[0];
  if (best) {
    const answer = bestSentences(best.content, terms);
    return { reply: name ? t('app.inbox.suggest.demo.found', { name, answer }) : t('app.inbox.suggest.demo.foundAnon', { answer }), grounded: true };
  }
  return { reply: name ? t('app.inbox.suggest.demo.notFound', { name }) : t('app.inbox.suggest.demo.notFoundAnon'), grounded: false };
}

/**
 * Prépare le brouillon de réponse à une conversation : lit les derniers messages, cherche dans la base de quoi répondre, demande un brouillon à l'IA, et garde la suggestion
 * (pour mesurer ce qu'on en fait). L'IA n'envoie rien et n'a aucun outil : une personne relit et envoie. Ne lève jamais.
 */
export async function suggestForConversation(deps: SuggestDeps, conversationId: string): Promise<SuggestResult> {
  const { repos } = deps;
  const conversation = await repos.inbox.getConversation(conversationId);
  if (!conversation) return { ok: false, error: 'not_found' };
  const now = deps.now ?? new Date();
  if (replyWindow(conversation.replyWindowExpiresAt, now).state === 'expired') return { ok: false, error: 'window_closed' };
  const turns = turnsOf(conversation);
  if (!turns.some((t) => t.role === 'customer')) return { ok: false, error: 'invalid' };
  if ((await repos.suggestions.countToday()) >= deps.dailyLimit) return { ok: false, error: 'rate_limited' };

  const split = splitKnowledge(await repos.knowledge.list());
  const found = await retrieve({ knowledge: repos.knowledge, embedder: deps.demo ? null : deps.embedder }, suggestQuery(turns), { exclude: split.inPrompt.map((i) => i.id), signal: deps.signal }).catch(() => NOTHING);
  const entries = split.inPrompt.map(({ title, content }) => ({ title, content }));
  const maxChars = SUGGEST_MAX_CHARS[conversation.kind];
  const model = deps.demo ? 'demo' : (deps.model ?? aiModel());

  let reply: string;
  let grounded: boolean;
  let needsHuman = false;
  let usage: { input: number | null; output: number | null } = { input: null, output: null };

  if (deps.demo) {
    ({ reply, grounded } = demoReply(deps.demo.t, firstName(conversation.contactName), found, queryTerms(suggestQuery(turns))));
  } else {
    try {
      const block = knowledgeBlock(entries);
      const response = await (deps.client ?? sdkClient()).create({
        model,
        instructions: block ? `${SUGGEST_RULES}\n\n${block}` : SUGGEST_RULES,
        input: suggestPrompt({
          orgName: deps.orgName, networkName: networkName(conversation.networkId), accountName: conversation.accountName, kind: conversation.kind, contactName: conversation.contactName,
          today: now.toISOString().slice(0, 10), maxChars, turns, passages: passagesBlock(found.passages),
        }),
        text: { format: { type: 'json_schema', name: 'reply', schema: SUGGEST_SCHEMA, strict: true } },
        max_output_tokens: 1_500,
        store: false,
        safety_identifier: deps.safetyId,
      });
      check(response);
      const raw = parseJsonText(textOf(response)) as { reply?: unknown; grounded?: unknown; needs_human?: unknown } | null;
      if (!raw || typeof raw.reply !== 'string' || typeof raw.grounded !== 'boolean' || typeof raw.needs_human !== 'boolean') throw new Error('réponse de la suggestion illisible');
      reply = fitReply(raw.reply, maxChars);
      needsHuman = raw.needs_human;
      // « Fondée sur la base » n'est vrai que si l'IA le dit et qu'elle avait de quoi s'appuyer : fiches épinglées ou passages retrouvés.
      grounded = raw.grounded && (entries.length > 0 || found.passages.length > 0);
      if (!reply && !needsHuman) throw new Error('suggestion vide');
      usage = { input: response.usage?.input_tokens ?? null, output: response.usage?.output_tokens ?? null };
    } catch (error) {
      const code = errorCode(error);
      return { ok: false, error: code === 'refused' ? 'refused' : code === 'disabled' ? 'disabled' : code === 'rate_limited' ? 'rate_limited' : 'failed' };
    }
  }

  const sources = found.consulted;
  const id = (await repos.suggestions.log({ conversationId, reply, grounded, needsHuman, sources, model, inputTokens: usage.input, outputTokens: usage.output }).catch(() => null)) ?? '';
  return { ok: true, suggestion: { id, reply, grounded, needsHuman, sources } };
}

