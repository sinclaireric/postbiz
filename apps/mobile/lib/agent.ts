import { fetch as streamingFetch } from "expo/fetch";

import {
  createEventParser,
  parseVideoJobResponse,
  sanitizeProposals,
  type AgentChatRequest,
  type AgentErrorCode,
  type AgentEvent,
  type AgentMessage,
  type AgentProposal,
  type AgentProposalStatus,
  type AgentThread,
  type AgentVideoJob,
  type VideoJobResponse,
} from "@/lib/agent-protocol";
import { supabase } from "@/lib/supabase";
import type { ChannelNetwork } from "@/types";

// L'agent du mobile est celui du web : le téléphone envoie le message à `POST {EXPO_PUBLIC_WEB_URL}/api/agent/chat` avec le jeton Supabase de l'utilisateur, et lit
// la réponse au fil de l'eau. Même modèle (GPT-5.2, comme Postiz), mêmes règles, mêmes outils, mêmes conversations (tables `agent_threads` et `agent_messages`, lues
// et écrites ici avec la session de l'utilisateur : c'est la RLS de la base qui décide). La clé du modèle reste sur le serveur du web.

const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "").replace(/\/$/, "");

/** Faux si EXPO_PUBLIC_WEB_URL manque : l'agent ne peut pas joindre le serveur du web. */
export const agentConfigured = () => WEB_URL.length > 0;

/** Plafonds durs de caractères par réseau, identiques à ceux du web (`NETWORK_RULES`). X est compté pondéré : voir `lib/text-length.ts`. */
export const NETWORK_LIMITS: Partial<Record<ChannelNetwork, number>> = {
  facebook: 63_206,
  instagram: 2_200,
  x: 280,
  linkedin: 3_000,
  tiktok: 2_200,
  youtube: 5_000,
};

export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_MEDIA_PER_MESSAGE = 6;
export const MAX_CHANNELS = 12;

/** Une vidéo en cours est interrogée toutes les dix secondes (la route est limitée à 40 interrogations par minute et par personne). */
export const VIDEO_POLL_MS = 10_000;

const ERRORS: Record<AgentErrorCode, string> = {
  disabled: "L’agent n’est pas disponible : le service d’IA n’est pas configuré sur le serveur.",
  forbidden: "Votre rôle ne permet pas d’utiliser l’agent, ou votre session a expiré. Reconnectez-vous.",
  invalid: "La demande n’est pas valide. Reformulez-la, ou ouvrez une nouvelle conversation.",
  rate_limited: "Trop de demandes en peu de temps. Réessayez dans quelques minutes.",
  refused: "L’agent n’a pas pu répondre à cette demande. Reformulez-la.",
  empty: "L’agent n’a rien pu préparer. Précisez votre demande ou vérifiez les canaux cochés.",
  failed: "L’agent n’a pas pu répondre. Votre message est conservé : réessayez dans un instant.",
  not_found: "Cette conversation n’existe plus.",
  quota: "Vous avez utilisé toutes les actions d’IA incluses dans votre offre ce mois-ci. Passez à une offre supérieure depuis la page Facturation du site Postbiz.",
};

export const agentErrorMessage = (code: AgentErrorCode) => ERRORS[code] ?? ERRORS.failed;

/** Message de l'écran quand l'agent n'est pas joignable (variable d'environnement absente). */
export const NOT_CONFIGURED = "L’agent n’est pas configuré : renseignez EXPO_PUBLIC_WEB_URL (l’adresse du site Postbiz) dans le fichier .env de l’application.";

/**
 * Envoie un message à l'agent et rend chaque événement de la réponse dès qu'il arrive. La promesse se termine quand le flux est fini ;
 * une réponse qui s'arrête sans événement final (connexion coupée, page d'erreur) devient une erreur, jamais un silence.
 */
export async function streamAgentChat(req: AgentChatRequest, onEvent: (event: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!agentConfigured()) return onEvent({ type: "error", code: "disabled" });
  const { data } = await supabase.auth.getSession(); // renouvelle le jeton s'il est périmé
  const token = data.session?.access_token;
  if (!token) return onEvent({ type: "error", code: "forbidden" });

  let ended = false;
  const forward = (event: AgentEvent) => {
    if (event.type === "done" || event.type === "error") ended = true;
    onEvent(event);
  };

  try {
    const res = await streamingFetch(`${WEB_URL}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
      signal,
    });
    const parser = createEventParser();
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) forward(event);
      }
    } else {
      // Pas de flux sur cet appareil : la réponse arrive d'un bloc, mais elle est lue de la même façon.
      for (const event of parser.push(await res.text())) forward(event);
    }
    for (const event of parser.flush()) forward(event);
  } catch {
    if (signal?.aborted) return;
  }
  if (!ended && !signal?.aborted) onEvent({ type: "error", code: "failed" });
}

type Row = Record<string, any>;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((m: unknown): m is string => typeof m === "string") : []);
const toThread = (r: Row): AgentThread => ({ id: r.id, title: r.title, updatedAt: r.updated_at });
const toMessage = (r: Row): AgentMessage => ({
  id: r.id,
  role: r.role === "assistant" ? "assistant" : "user",
  text: r.content ?? "",
  proposals: sanitizeProposals(r.proposals),
  mediaIds: strings(r.media_ids),
  jobIds: strings(r.job_ids),
  createdAt: r.created_at,
});

/** Les conversations de l'utilisateur dans cette organisation, la plus récente d'abord. Les mêmes que sur le web. */
export async function listThreads(orgId: string, userId: string): Promise<AgentThread[]> {
  const { data } = await supabase
    .from("agent_threads")
    .select("id, title, updated_at")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []).map(toThread);
}

export async function loadThread(orgId: string, userId: string, id: string): Promise<{ thread: AgentThread; messages: AgentMessage[] } | null> {
  const { data: row } = await supabase.from("agent_threads").select("id, title, updated_at").eq("id", id).eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!row) return null;
  const { data } = await supabase
    .from("agent_messages")
    .select("id, role, content, proposals, media_ids, job_ids, created_at")
    .eq("thread_id", id)
    .order("created_at", { ascending: true })
    .limit(400);
  return { thread: toThread(row), messages: (data ?? []).map(toMessage) };
}

export async function deleteThread(orgId: string, userId: string, id: string): Promise<boolean> {
  const { error } = await supabase.from("agent_threads").delete().eq("id", id).eq("org_id", orgId).eq("user_id", userId);
  return !error;
}

/** Ce que l'utilisateur a fait d'une publication préparée : son état, et le texte, les médias et la date tels qu'il les a enregistrés. */
export type ProposalUpdate = Pick<AgentProposal, "id" | "text" | "firstComment" | "mediaIds" | "publishAt"> & { status: AgentProposalStatus };

/** Marque les publications d'un message comme enregistrées (brouillon ou programmée), pour que la conversation, sur le web comme ici, le montre. */
export async function markProposals(orgId: string, messageId: string, updates: ProposalUpdate[]): Promise<boolean> {
  const { data } = await supabase.from("agent_messages").select("proposals").eq("id", messageId).eq("org_id", orgId).maybeSingle();
  if (!data) return false;
  const next = sanitizeProposals(data.proposals).map((p) => {
    const u = updates.find((x) => x.id === p.id);
    return u ? { ...p, ...u } : p;
  });
  const { error } = await supabase.from("agent_messages").update({ proposals: next }).eq("id", messageId).eq("org_id", orgId);
  return !error;
}

const toJob = (r: Row): AgentVideoJob => ({
  id: r.id,
  // « saving » (une requête enregistre la vidéo terminée) est, pour l'utilisateur, une vidéo encore en cours.
  status: r.status === "completed" ? "completed" : r.status === "failed" ? "failed" : "pending",
  orientation: r.orientation === "horizontal" ? "horizontal" : "vertical",
  prompt: r.prompt ?? "",
  mediaId: r.media_id ?? null,
  error: r.error ?? null,
  createdAt: r.created_at,
});

/** Les vidéos lancées par une conversation, dans leur état du moment (tâches privées à leur auteur : la RLS ne rend que les siennes). */
export async function loadJobs(orgId: string, userId: string, ids: string[]): Promise<AgentVideoJob[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { data } = await supabase
    .from("ai_video_jobs")
    .select("id, status, orientation, prompt, media_id, error, created_at")
    .eq("org_id", orgId)
    .eq("created_by", userId)
    .in("id", unique);
  const byId = new Map(((data ?? []) as Row[]).map((r) => [r.id as string, toJob(r)]));
  return ids.map((id) => byId.get(id)).filter((j): j is AgentVideoJob => !!j);
}

/**
 * Interroge une vidéo en cours, ce qui la fait avancer côté serveur : une vidéo prête y est rangée dans la médiathèque. Null en cas d'erreur réseau,
 * de session expirée ou de réponse inattendue : l'appelant réessaiera à la prochaine interrogation.
 */
export async function fetchVideoJob(id: string, signal?: AbortSignal): Promise<VideoJobResponse | null> {
  if (!agentConfigured()) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${WEB_URL}/api/agent/video/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!res.ok) return null;
    return parseVideoJobResponse(await res.json());
  } catch {
    return null;
  }
}
