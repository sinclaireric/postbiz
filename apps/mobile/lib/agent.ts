import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import type { ChannelNetwork } from "@/types";

// Appelle l'Edge Function `agent-compose` (supabase/functions/agent-compose). La clé du modèle d'IA reste côté serveur.

export const AGENT_TONES = ["professionnel", "chaleureux", "décontracté", "inspirant", "humoristique"] as const;
export type AgentTone = (typeof AGENT_TONES)[number];

export const MAX_BRIEF_LENGTH = 1500;

/** Plafonds durs, identiques à ceux de la fonction (HARD_LIMITS). */
export const NETWORK_LIMITS: Partial<Record<ChannelNetwork, number>> = {
  facebook: 63_206,
  instagram: 2_200,
  x: 280,
  linkedin: 3_000,
  tiktok: 2_200,
  youtube: 5_000,
};

export type AgentDraft = { network: ChannelNetwork; text: string };
export type AgentResult = { ok: true; drafts: AgentDraft[] } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  unauthorized: "Session expirée. Reconnectez-vous.",
  forbidden: "Votre rôle ne permet pas d’utiliser l’agent.",
  brief_required: "Décrivez ce que vous voulez publier.",
  brief_too_long: `Le brief est limité à ${MAX_BRIEF_LENGTH} caractères.`,
  networks_required: "Choisissez au moins un canal.",
  model_unavailable: "Le service de rédaction est indisponible pour le moment. Réessayez plus tard.",
  bad_model_output: "L’agent n’a pas produit de texte exploitable. Réessayez.",
};

export async function composePosts(brief: string, networks: ChannelNetwork[], tone: AgentTone): Promise<AgentResult> {
  const { data, error } = await supabase.functions.invoke("agent-compose", { body: { brief, networks, tone } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      if (error.context.status === 404) return { ok: false, error: "L’agent n’est pas encore activé sur ce projet (fonction non déployée)." };
      const code = await error.context.json().then((j: { error?: string }) => j.error ?? "", () => "");
      return { ok: false, error: MESSAGES[code] ?? "L’agent a rencontré une erreur. Réessayez." };
    }
    return { ok: false, error: "Connexion impossible. Vérifiez votre réseau." };
  }
  const posts = (data as { posts?: { network: ChannelNetwork; text: string }[] } | null)?.posts;
  if (!Array.isArray(posts) || posts.length === 0) return { ok: false, error: MESSAGES.bad_model_output };
  return { ok: true, drafts: posts.map((p) => ({ network: p.network, text: p.text })) };
}
