import { createLimiter } from '@/lib/ai/rate-limit';
import { isValidTimeZone } from './time';
import { AGENT_LIMITS, type AgentChatRequest, type AgentEvent } from './types';

/**
 * Limite d'appels de l'agent par utilisateur : chaque message peut coûter jusqu'à `toolTurns` appels au modèle, bien plus qu'une proposition
 * de l'assistant du composeur. 20 messages par 10 minutes laissent largement la place à une vraie conversation et coupent une boucle ou un abus.
 */
export const agentLimiter = createLimiter(20, 10 * 60_000);

/**
 * Interrogations d'une vidéo en cours : le navigateur et le mobile le font toutes les dix secondes ; chaque interrogation peut appeler le fournisseur.
 * 40 par minute laissent la place à quelques vidéos et conversations ouvertes en même temps.
 */
export const videoPollLimiter = createLimiter(40, 60_000);

const ID = /^[\w-]{1,64}$/;

const ids = (value: unknown, max: number): string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.some((v) => typeof v !== 'string' || !ID.test(v))) return null;
  return [...new Set(value as string[])].slice(0, max);
};

/** Lit une requête venue du navigateur (donnée non fiable) : renvoie null si elle est incomplète ou démesurée. */
export function parseChatRequest(raw: unknown): AgentChatRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.message !== undefined && typeof r.message !== 'string') return null;
  const message = typeof r.message === 'string' ? r.message.replace(/\r\n/g, '\n').trim() : '';
  const channelIds = ids(r.channelIds, AGENT_LIMITS.channels);
  const mediaIds = ids(r.mediaIds, AGENT_LIMITS.mediaPerMessage);
  const threadId = r.threadId === null || r.threadId === undefined ? null : typeof r.threadId === 'string' && ID.test(r.threadId) ? r.threadId : undefined;
  if (threadId === undefined || !channelIds || !mediaIds) return null;
  if (message.length > AGENT_LIMITS.message || (!message && mediaIds.length === 0)) return null;
  return { threadId, message, channelIds, mediaIds, timeZone: isValidTimeZone(r.timeZone) ? r.timeZone : 'UTC' };
}

/** Un événement par ligne : le format de la réponse en flux de la route d'API. */
export const encodeEvent = (event: AgentEvent): string => `${JSON.stringify(event)}\n`;

const TYPES = new Set<AgentEvent['type']>(['text', 'tool', 'proposals', 'media', 'job', 'done', 'error']);

/** Lit une ligne de la réponse ; null si ce n'est pas un événement (une ligne abîmée n'arrête pas la lecture). */
export function parseEventLine(line: string): AgentEvent | null {
  try {
    const value = JSON.parse(line) as { type?: unknown };
    return value && typeof value === 'object' && TYPES.has(value.type as AgentEvent['type']) ? (value as AgentEvent) : null;
  } catch {
    return null;
  }
}

/** Découpe un flux de texte en événements, même quand une ligne arrive en deux morceaux. */
export function createEventParser(): { push(chunk: string): AgentEvent[]; flush(): AgentEvent[] } {
  let buffer = '';
  const lines = (parts: string[]) => parts.map((l) => l.trim()).filter(Boolean).map(parseEventLine).filter((e): e is AgentEvent => e !== null);
  return {
    push(chunk) {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      return lines(parts);
    },
    flush() {
      const rest = buffer;
      buffer = '';
      return lines([rest]);
    },
  };
}

export interface SaveAgentItem {
  id: string;
  integrationId: string;
  text: string;
  firstComment: string | null;
  mediaIds: string[];
  /** ISO (UTC) ; vide pour un brouillon sans date. */
  publishAt: string | null;
}

export interface SaveAgentRequest {
  threadId: string;
  messageId: string;
  mode: 'draft' | 'schedule';
  items: SaveAgentItem[];
}

const MAX_TEXT = 20_000;

/** Lit la demande d'enregistrement des publications d'un message de l'agent (donnée non fiable : tout est relu et borné). */
export function parseSaveRequest(raw: unknown): SaveAgentRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.threadId !== 'string' || !ID.test(r.threadId) || typeof r.messageId !== 'string' || !ID.test(r.messageId)) return null;
  if (r.mode !== 'draft' && r.mode !== 'schedule') return null;
  if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > AGENT_LIMITS.proposalsPerCall) return null;

  const items: SaveAgentItem[] = [];
  for (const item of r.items) {
    if (typeof item !== 'object' || item === null) return null;
    const i = item as Record<string, unknown>;
    const mediaIds = ids(i.mediaIds, 20);
    const publishAt = i.publishAt === null || i.publishAt === undefined || i.publishAt === '' ? null : typeof i.publishAt === 'string' && i.publishAt.length <= 40 && !Number.isNaN(Date.parse(i.publishAt)) ? new Date(i.publishAt).toISOString() : undefined;
    const comment = i.firstComment === null || i.firstComment === undefined ? null : typeof i.firstComment === 'string' && i.firstComment.length <= MAX_TEXT ? i.firstComment : undefined;
    if (typeof i.id !== 'string' || !ID.test(i.id) || typeof i.integrationId !== 'string' || !ID.test(i.integrationId)) return null;
    if (typeof i.text !== 'string' || i.text.length > MAX_TEXT || !mediaIds || publishAt === undefined || comment === undefined) return null;
    if (items.some((x) => x.id === i.id)) return null;
    items.push({ id: i.id, integrationId: i.integrationId, text: i.text, firstComment: comment, mediaIds, publishAt });
  }
  return { threadId: r.threadId, messageId: r.messageId, mode: r.mode, items };
}
