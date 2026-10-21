import type { AiIdea, AiProposal } from './types';
import { IDEAS_PER_REQUEST } from './prompt';

/** Lit le JSON de la réponse du modèle, même s'il l'a entouré de texte ou d'une clôture de code. Null si rien d'exploitable. */
export function parseJsonText(text: string): unknown {
  const attempt = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const whole = attempt(text.trim());
  if (whole !== undefined) return whole;
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  return from >= 0 && to > from ? (attempt(text.slice(from, to + 1)) ?? null) : null;
}

/** Texte d'un post tel qu'on l'insère : sans clôture de code ni guillemets autour, sans lignes vides en trop. */
export function cleanPostText(value: string): string {
  let t = value.replace(/\r\n/g, '\n').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  if (/^["“«].*["”»]$/s.test(t) && !/["“«]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  return t.replace(/\n{3,}/g, '\n\n');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Propositions valides : non vides, dans la limite de chaque canal (`fits`), sans doublon. */
export function normalizeProposals(raw: unknown, fits: (text: string) => boolean, wanted: number): AiProposal[] {
  const list = isRecord(raw) && Array.isArray(raw.proposals) ? raw.proposals : [];
  const seen = new Set<string>();
  const out: AiProposal[] = [];
  for (const item of list) {
    const text = isRecord(item) && typeof item.text === 'string' ? cleanPostText(item.text) : '';
    const key = text.toLowerCase();
    if (!text || !fits(text) || seen.has(key)) continue;
    seen.add(key);
    out.push({ text });
    if (out.length >= wanted) break;
  }
  return out;
}

/** Adresse http(s) normalisée pour comparer (sans fragment, sans « / » final), ou null si ce n'en est pas une. */
export function normalizeUrl(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Idées valides. Une idée d'actualité n'est gardée que si sa source figure parmi les adresses trouvées par la recherche web :
 * le modèle ne peut pas citer un article qu'il n'a pas vu.
 */
export function normalizeIdeas(raw: unknown, fits: (text: string) => boolean, sources: { title: string; url: string }[], allowNews: boolean, allowKnowledge: boolean): AiIdea[] {
  const list = isRecord(raw) && Array.isArray(raw.ideas) ? raw.ideas : [];
  const known = new Map<string, { title: string; url: string }>();
  for (const s of sources) {
    const key = normalizeUrl(s.url);
    if (key) known.set(key, s);
  }
  const out: AiIdea[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const text = typeof item.text === 'string' ? cleanPostText(item.text) : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const angle = typeof item.angle === 'string' ? item.angle.trim() : '';
    if (!text || !fits(text) || !title) continue;
    if (item.origin === 'news') {
      const key = typeof item.source_url === 'string' ? normalizeUrl(item.source_url) : null;
      const source = key ? known.get(key) : undefined;
      if (!allowNews || !source) continue;
      out.push({ title, angle, text, origin: 'news', source: { title: source.title, url: source.url } });
    } else if (allowKnowledge) {
      out.push({ title, angle, text, origin: 'knowledge', source: null });
    }
    if (out.length >= IDEAS_PER_REQUEST) break;
  }
  return out;
}
