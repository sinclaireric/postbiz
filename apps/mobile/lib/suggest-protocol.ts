// La suggestion de réponse du mobile est celle du web : le téléphone appelle `POST {EXPO_PUBLIC_WEB_URL}/api/inbox/suggest` avec le jeton Supabase de l'utilisateur et met le
// brouillon reçu dans le champ de réponse ; une personne le relit, le corrige et l'envoie (rien ne part seul). Ce fichier est le miroir (sans dépendance) de ce que le web
// envoie et reçoit : types de apps/web/src/lib/inbox/suggest.ts, route apps/web/src/app/api/inbox/suggest/route.ts, comparaison `sameReply` de
// apps/web/src/lib/inbox/suggest-prompt.ts. Il est testé par lib/suggest-protocol.test.ts ; l'appel avec la session de l'utilisateur est dans lib/suggest.ts.

export const SUGGEST_ERROR_CODES = ["disabled", "forbidden", "invalid", "rate_limited", "refused", "failed", "not_found", "window_closed"] as const;
export type SuggestErrorCode = (typeof SUGGEST_ERROR_CODES)[number];

/** Ce que la suggestion rend à l'écran : le brouillon, ce qui le fonde, et si une personne doit s'en charger. */
export interface Suggestion {
  /** Identifiant de la suggestion gardée en base (vide si elle n'a pas pu l'être) : sert à noter ce que l'utilisateur en a fait. */
  id: string;
  /** Le brouillon ; vide quand `needsHuman` est vrai et qu'aucune réponse ne doit partir. */
  reply: string;
  /** Vrai : la réponse s'appuie sur la base de connaissance. Faux : rien n'y répondait, le brouillon n'est qu'une réponse d'attente. */
  grounded: boolean;
  needsHuman: boolean;
  /** Titres des fiches dont viennent les passages retrouvés. */
  sources: string[];
}

export type SuggestResult = { ok: true; suggestion: Suggestion } | { ok: false; error: SuggestErrorCode };

/** Ce que l'utilisateur a fait de la suggestion : `sent` (envoyée telle quelle) ou `edited` (envoyée après modification). Les deux valeurs de `ai_reply_suggestions.outcome`. */
export type SuggestOutcome = "sent" | "edited";

const ID = /^[\w-]{1,64}$/;
/** Ce que la table `ai_reply_suggestions` accepte (colonne `reply` : 5 000 signes, colonne `sources` : 12 titres). */
const MAX_REPLY = 5_000;
const MAX_SOURCES = 12;
const MAX_TITLE = 200;

const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function readSuggestion(v: unknown): Suggestion | null {
  const s = record(v);
  if (!s || typeof s.id !== "string" || typeof s.reply !== "string" || s.reply.length > MAX_REPLY || typeof s.grounded !== "boolean" || typeof s.needsHuman !== "boolean") return null;
  const sources = Array.isArray(s.sources) ? s.sources.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.slice(0, MAX_TITLE)).slice(0, MAX_SOURCES) : [];
  // Un identifiant qui n'a pas la forme attendue ne sert à rien : la suggestion s'affiche, mais son issue ne sera pas notée (même contrôle que le web, à l'envoi).
  return { id: ID.test(s.id) ? s.id : "", reply: s.reply, grounded: s.grounded, needsHuman: s.needsHuman, sources };
}

/**
 * Lit la réponse de `POST /api/inbox/suggest` (donnée non fiable : une page d'erreur, ou une réponse abîmée, donne `failed`, jamais une exception).
 * Une suggestion n'est prise qu'avec un statut 2xx ; sinon c'est le code d'erreur de la route (`{ error }`, avec le statut 503, 403 ou 401 sans session, 400, 429, 422, 502, 404 ou 409).
 * Un code inconnu, ou absent, devient `failed`, comme sur le web : le statut seul n'est pas fiable (un serveur intermédiaire peut renvoyer 429 ou 503 sans venir de la route).
 */
export function parseSuggestResponse(status: number, raw: unknown): SuggestResult {
  const body = record(raw);
  if (status >= 200 && status < 300) {
    const suggestion = readSuggestion(body?.suggestion);
    if (suggestion) return { ok: true, suggestion };
  }
  const error = SUGGEST_ERROR_CODES.find((code) => code === body?.error);
  return { ok: false, error: error ?? "failed" };
}

/** Deux réponses sont les mêmes si elles ne diffèrent que par les espaces (même règle que `sameReply` du web). */
export const sameReply = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** Ce qu'on retient d'une suggestion envoyée : telle quelle (`sent`) ou modifiée (`edited`). */
export const replyOutcome = (draft: string, sent: string): SuggestOutcome => (sameReply(draft, sent) ? "sent" : "edited");

/**
 * Note ce qu'on a fait d'une suggestion au moment de l'envoi. `save` écrit l'issue (colonne `outcome` de `ai_reply_suggestions`, la seule que l'auteur puisse modifier) ;
 * une suggestion sans identifiant n'a jamais été gardée en base : rien à noter. Ne lève jamais : la mesure n'est pas essentielle, un échec ne doit pas gêner l'envoi.
 */
export async function recordOutcome(save: (id: string, outcome: SuggestOutcome) => PromiseLike<unknown>, suggestion: Pick<Suggestion, "id" | "reply">, sent: string): Promise<void> {
  if (!suggestion.id) return;
  try {
    await save(suggestion.id, replyOutcome(suggestion.reply, sent));
  } catch {
    // Voir ci-dessus.
  }
}

/**
 * Délai maximal d'une demande. La route s'arrête d'elle-même au bout de 30 s (`maxDuration` : une recherche dans la base, puis un appel au modèle) : on attend un peu plus,
 * pour lire sa réponse d'erreur plutôt que de couper avant elle.
 */
export const SUGGEST_TIMEOUT_MS = 35_000;

export interface SuggestRequest {
  /** Adresse du site, sans « / » final. */
  webUrl: string;
  /** Jeton d'accès Supabase de l'utilisateur (`Authorization: Bearer`). */
  token: string;
  conversationId: string;
  /** Pour abandonner la demande (écran quitté). */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Le `fetch` à utiliser (celui de l'appareil par défaut) ; passé par les tests. */
  fetch?: typeof fetch;
}

/** Demande un brouillon de réponse au serveur du web. Ne lève jamais : réseau coupé, délai dépassé, demande abandonnée ou réponse illisible donnent `failed`. */
export async function postSuggest({ webUrl, token, conversationId, signal, timeoutMs = SUGGEST_TIMEOUT_MS, fetch: doFetch = fetch }: SuggestRequest): Promise<SuggestResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const res = await doFetch(`${webUrl}/api/inbox/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId }),
      signal: controller.signal,
    });
    const raw: unknown = await res.json().catch(() => null);
    return parseSuggestResponse(res.status, raw);
  } catch {
    return { ok: false, error: "failed" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
