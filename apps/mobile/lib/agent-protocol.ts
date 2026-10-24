// L'agent du mobile est celui du web : mêmes règles, même modèle, mêmes conversations. Ce fichier est le miroir (sans dépendance) de ce que le web envoie
// et reçoit : types de apps/web/src/lib/agent/types.ts, lecture du flux de apps/web/src/lib/agent/request.ts. Un test du web
// (apps/web/src/lib/agent/mobile-protocol.test.ts) fait tourner les deux lecteurs sur les mêmes lignes pour qu'ils ne divergent pas.

export const AGENT_EVENT_TYPES = ["text", "tool", "proposals", "done", "error"] as const;
export const AGENT_TOOLS = ["list_posts", "list_media", "propose_posts"] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

export type AgentErrorCode = "disabled" | "forbidden" | "invalid" | "rate_limited" | "refused" | "empty" | "failed" | "not_found";

/** `pending` : à relire ; `draft` : enregistrée en brouillon ; `scheduled` : programmée. */
export type AgentProposalStatus = "pending" | "draft" | "scheduled";

export interface AgentProposal {
  id: string;
  integrationId: string;
  networkId: string;
  accountName: string;
  text: string;
  firstComment: string | null;
  mediaIds: string[];
  /** Date proposée (ISO, UTC) ; vide : l'application propose le prochain créneau. */
  publishAt: string | null;
  status: AgentProposalStatus;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposals: AgentProposal[];
  mediaIds: string[];
  createdAt: string;
}

export interface AgentThread {
  id: string;
  title: string;
  updatedAt: string;
}

export interface AgentMedia {
  id: string;
  kind: "image" | "video";
  name: string;
  alt: string;
  url: string | null;
  thumbUrl: string | null;
  durationSeconds: number | null;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: AgentToolName }
  | { type: "proposals"; proposals: AgentProposal[]; media: AgentMedia[] }
  | { type: "done"; thread: AgentThread; user: AgentMessage; assistant: AgentMessage }
  | { type: "error"; code: AgentErrorCode };

/** Corps de la requête envoyée à `POST /api/agent/chat`. */
export interface AgentChatRequest {
  threadId: string | null;
  message: string;
  channelIds: string[];
  mediaIds: string[];
  timeZone: string;
}

/** Lit une ligne de la réponse ; null si ce n'est pas un événement (une ligne abîmée n'arrête pas la lecture). */
export function parseEventLine(line: string): AgentEvent | null {
  try {
    const value = JSON.parse(line) as { type?: unknown };
    return value && typeof value === "object" && (AGENT_EVENT_TYPES as readonly unknown[]).includes(value.type) ? (value as AgentEvent) : null;
  } catch {
    return null;
  }
}

/** Découpe un flux de texte en événements, même quand une ligne arrive en deux morceaux. */
export function createEventParser(): { push(chunk: string): AgentEvent[]; flush(): AgentEvent[] } {
  let buffer = "";
  const lines = (parts: string[]) => parts.map((l) => l.trim()).filter(Boolean).map(parseEventLine).filter((e): e is AgentEvent => e !== null);
  return {
    push(chunk) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      return lines(parts);
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return lines([rest]);
    },
  };
}

const NETWORK_IDS = ["facebook", "instagram", "instagram_standalone", "x", "linkedin", "linkedin_page", "tiktok", "youtube"];
const STATUSES: readonly AgentProposalStatus[] = ["pending", "draft", "scheduled"];
const MAX_TEXT = 20_000;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/**
 * Relit les publications gardées dans un message (colonne `proposals`). La colonne est modifiable par son propriétaire : on ne se fie pas à sa forme,
 * on garde ce qui est exploitable et on écarte le reste. Même règle que `sanitizeProposals` du web.
 */
export function sanitizeProposals(raw: unknown): AgentProposal[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AgentProposal[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const r = item as Record<string, unknown>;
    const id = str(r.id, 64);
    const integrationId = str(r.integrationId, 64);
    const accountName = str(r.accountName, 200);
    const text = str(r.text, MAX_TEXT);
    const networkId = typeof r.networkId === "string" && NETWORK_IDS.includes(r.networkId) ? r.networkId : null;
    const status = STATUSES.find((s) => s === r.status);
    if (!id || !integrationId || accountName === null || text === null || !networkId || !status) return [];
    const publishAt = typeof r.publishAt === "string" && !Number.isNaN(Date.parse(r.publishAt)) ? r.publishAt : null;
    const mediaIds = Array.isArray(r.mediaIds) ? r.mediaIds.filter((m): m is string => typeof m === "string" && m.length <= 64).slice(0, 20) : [];
    return [{ id, integrationId, networkId, accountName, text, firstComment: str(r.firstComment, MAX_TEXT), mediaIds, publishAt, status }];
  });
}
