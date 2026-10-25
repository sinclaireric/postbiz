// L'agent du mobile est celui du web : mêmes règles, même modèle, mêmes conversations. Ce fichier est le miroir (sans dépendance) de ce que le web envoie
// et reçoit : types de apps/web/src/lib/agent/types.ts, lecture du flux de apps/web/src/lib/agent/request.ts. Un test du web
// (apps/web/src/lib/agent/mobile-protocol.test.ts) fait tourner les deux lecteurs sur les mêmes lignes pour qu'ils ne divergent pas.

export const AGENT_EVENT_TYPES = ["text", "tool", "proposals", "media", "job", "done", "error"] as const;
export const AGENT_TOOLS = ["list_posts", "list_media", "propose_posts", "generate_image", "generate_video", "video_status"] as const;
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
  /** Message de l'utilisateur : médias joints. Message de l'agent : images qu'il a générées. */
  mediaIds: string[];
  /** Vidéos que l'agent a lancées dans ce message (leur état change après coup : voir `AgentVideoJob`). */
  jobIds: string[];
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

/** `pending` : en cours chez le fournisseur ; `completed` : enregistrée dans la médiathèque ; `failed` : abandonnée (`error` en donne la raison). */
export type AgentJobStatus = "pending" | "completed" | "failed";
export type VideoOrientation = "vertical" | "horizontal";

/** Une vidéo en cours de génération (Seedance) : elle prend plusieurs minutes, bien plus qu'une réponse de l'agent. */
export interface AgentVideoJob {
  id: string;
  status: AgentJobStatus;
  orientation: VideoOrientation;
  prompt: string;
  mediaId: string | null;
  error: string | null;
  createdAt: string;
}

/** Ce que renvoie `GET /api/agent/video/<id>` : l'état de la vidéo, et, une fois prête, son média et une adresse signée pour la lire. */
export interface VideoJobResponse {
  job: AgentVideoJob;
  media: AgentMedia | null;
  url: string | null;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: AgentToolName }
  | { type: "proposals"; proposals: AgentProposal[]; media: AgentMedia[] }
  /** Images que l'agent vient de générer : déjà dans la médiathèque. */
  | { type: "media"; media: AgentMedia[] }
  /** Une vidéo vient d'être lancée (ou son état a changé). */
  | { type: "job"; job: AgentVideoJob }
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

const isString = (v: unknown): v is string => typeof v === "string";

function readJob(v: unknown): AgentVideoJob | null {
  if (typeof v !== "object" || v === null) return null;
  const j = v as Record<string, unknown>;
  if (!isString(j.id) || !isString(j.prompt) || !isString(j.createdAt)) return null;
  if (j.status !== "pending" && j.status !== "completed" && j.status !== "failed") return null;
  if (j.orientation !== "vertical" && j.orientation !== "horizontal") return null;
  if (j.mediaId !== null && !isString(j.mediaId)) return null;
  if (j.error !== null && !isString(j.error)) return null;
  return { id: j.id, status: j.status, orientation: j.orientation, prompt: j.prompt, mediaId: j.mediaId, error: j.error, createdAt: j.createdAt };
}

function readMedia(v: unknown): AgentMedia | null | undefined {
  if (v === null) return null;
  if (typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  if (!isString(m.id) || !isString(m.name) || (m.kind !== "image" && m.kind !== "video")) return undefined;
  const nullable = (x: unknown) => (isString(x) ? x : null);
  return { id: m.id, kind: m.kind, name: m.name, alt: isString(m.alt) ? m.alt : "", url: nullable(m.url), thumbUrl: nullable(m.thumbUrl), durationSeconds: typeof m.durationSeconds === "number" ? m.durationSeconds : null };
}

/** Lit la réponse de `GET /api/agent/video/<id>` (donnée non fiable : une réponse abîmée, ou une page d'erreur, donne null). Même lecture que le web. */
export function parseVideoJobResponse(raw: unknown): VideoJobResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const job = readJob(r.job);
  const media = readMedia(r.media);
  if (!job || media === undefined || (r.url !== null && !isString(r.url))) return null;
  return { job, media, url: r.url as string | null };
}
