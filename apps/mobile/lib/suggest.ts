import { supabase } from "@/lib/supabase";
import { postSuggest, recordOutcome, type SuggestErrorCode, type SuggestResult, type Suggestion } from "@/lib/suggest-protocol";

// La suggestion de réponse du mobile est celle du web : le téléphone demande le brouillon à `POST {EXPO_PUBLIC_WEB_URL}/api/inbox/suggest` avec le jeton Supabase de l'utilisateur
// (voir lib/suggest-protocol.ts pour ce que la route attend et rend). La base de connaissance, le modèle et leurs clés restent sur le serveur du web : l'application n'envoie que
// l'identifiant de la conversation. L'issue de la suggestion (envoyée telle quelle ou modifiée) est écrite ici, avec la session de l'utilisateur : c'est la RLS de la base qui décide.

const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "").replace(/\/$/, "");

/** Faux si EXPO_PUBLIC_WEB_URL manque : la suggestion ne peut pas joindre le serveur du web. */
export const suggestConfigured = () => WEB_URL.length > 0;

const ERRORS: Record<SuggestErrorCode, string> = {
  disabled: "La suggestion n’est pas disponible : le service d’IA n’est pas configuré sur le serveur.",
  forbidden: "Votre rôle ne permet pas de suggérer une réponse, ou votre session a expiré. Reconnectez-vous.",
  invalid: "Aucune réponse ne peut être suggérée pour cette conversation.",
  rate_limited: "Trop de suggestions en peu de temps, ou limite du jour atteinte. Réessayez plus tard.",
  refused: "L’IA n’a pas pu répondre à ce message. Écrivez la réponse vous-même.",
  failed: "La suggestion a échoué. Réessayez dans un instant.",
  not_found: "Conversation introuvable.",
  window_closed: "La fenêtre de 24 h est dépassée : il n’est plus possible de répondre.",
};

export const suggestErrorMessage = (code: SuggestErrorCode) => ERRORS[code] ?? ERRORS.failed;

/** Message de l'écran quand la suggestion n'est pas joignable (variable d'environnement absente). */
export const NOT_CONFIGURED = "La suggestion n’est pas configurée : renseignez EXPO_PUBLIC_WEB_URL (l’adresse du site Postbiz) dans le fichier .env de l’application.";

/** Demande un brouillon de réponse à une conversation de l'inbox. Ne lève jamais : toute erreur devient un code (`failed` si on ne sait pas mieux). */
export async function requestSuggestion(conversationId: string, signal?: AbortSignal): Promise<SuggestResult> {
  if (!suggestConfigured()) return { ok: false, error: "disabled" };
  try {
    const { data, error } = await supabase.auth.getSession(); // renouvelle le jeton s'il est périmé
    const token = data.session?.access_token;
    // Ni session ni erreur : la personne n'est plus connectée. Une erreur : le jeton n'a pas pu être renouvelé (réseau coupé) ; ce n'est pas à elle de se reconnecter.
    if (!token) return { ok: false, error: error ? "failed" : "forbidden" };
    return await postSuggest({ webUrl: WEB_URL, token, conversationId, signal });
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * Note ce que l'utilisateur a fait de la suggestion qu'il vient d'envoyer : `sent` (telle quelle) ou `edited` (modifiée), dans `ai_reply_suggestions.outcome`.
 * La RLS ne laisse l'auteur modifier que cette colonne. Ne lève jamais et n'est pas à attendre : un échec ne doit pas gêner l'envoi.
 */
export const settleSuggestion = (suggestion: Pick<Suggestion, "id" | "reply">, sent: string): Promise<void> =>
  recordOutcome((id, outcome) => supabase.from("ai_reply_suggestions").update({ outcome }).eq("id", id), suggestion, sent);
