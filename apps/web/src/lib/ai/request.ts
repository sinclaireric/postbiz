import { NETWORK_RULES } from '@/lib/posts/logic';
import type { NetworkId } from '@/lib/inbox/types';
import { AI_ACTIONS, AI_LENGTHS, AI_TONES, type AiAction, type AiLength, type AiRequest, type AiTone } from './types';

/** Bornes de ce que le serveur accepte : l'assistant est facturé à l'usage, la demande ne doit pas pouvoir être démesurée. */
export const AI_INPUT_LIMITS = { topic: 600, text: 5_000, theme: 300, networks: 6 } as const;

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function networks(value: unknown): NetworkId[] {
  if (!Array.isArray(value)) return [];
  const known = value.filter((id): id is NetworkId => typeof id === 'string' && id in NETWORK_RULES);
  return [...new Set(known)].slice(0, AI_INPUT_LIMITS.networks);
}

/** Lit une demande venue du navigateur (donnée non fiable) : renvoie null si elle est incomplète ou démesurée. */
export function parseAiRequest(raw: unknown): AiRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const tone: AiTone = pick(AI_TONES, r.tone, 'professional');
  const networkIds = networks(r.networkIds);

  if (r.mode === 'write') {
    const topic = text(r.topic, AI_INPUT_LIMITS.topic);
    if (!topic) return null;
    return { mode: 'write', topic, tone, length: pick<AiLength>(AI_LENGTHS, r.length, 'medium'), networkIds, useKnowledge: r.useKnowledge !== false };
  }
  if (r.mode === 'improve') {
    const body = text(r.text, AI_INPUT_LIMITS.text);
    if (!body || !(AI_ACTIONS as readonly unknown[]).includes(r.action)) return null;
    return { mode: 'improve', action: r.action as AiAction, text: body, tone, networkIds, useKnowledge: r.useKnowledge === true };
  }
  if (r.mode === 'ideas') {
    const news = r.news === true;
    const knowledge = r.knowledge === true;
    if (!news && !knowledge) return null;
    // Le thème est facultatif : sans lui, l'assistant part de la base de connaissance et de ce que fait l'organisation.
    const theme = r.theme === undefined || r.theme === '' ? '' : text(r.theme, AI_INPUT_LIMITS.theme);
    if (theme === null) return null;
    return { mode: 'ideas', theme, news, knowledge, tone, networkIds };
  }
  return null;
}
