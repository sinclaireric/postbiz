/** Traduit les erreurs courantes de Supabase Auth / PostgREST en messages lisibles (jamais le message brut du serveur). */
export function authErrorMessage(error: { message?: string; code?: string; status?: number } | null | undefined): string {
  if (!error) return "Une erreur est survenue. Réessayez dans un instant.";
  const msg = (error.message ?? "").toLowerCase();
  const code = error.code ?? "";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "E-mail ou mot de passe incorrect.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "Confirmez d’abord votre adresse e-mail grâce au lien reçu.";
  if (code === "user_already_exists" || msg.includes("already registered")) return "Un compte existe déjà avec cette adresse e-mail.";
  if (code === "weak_password" || msg.includes("password should be")) return "Mot de passe trop faible : 8 caractères minimum.";
  if (code === "same_password") return "Choisissez un mot de passe différent de l’ancien.";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return "Trop de tentatives. Patientez une minute avant de réessayer.";
  }
  if (msg.includes("network") || msg.includes("fetch")) return "Connexion impossible. Vérifiez votre réseau.";
  return "Une erreur est survenue. Réessayez dans un instant.";
}

export const GENERIC_ERROR = "L’opération a échoué. Réessayez dans un instant.";

export type Result = { ok: true } | { ok: false; error: string };
export const ok = (): Result => ({ ok: true });
export const fail = (error: string = GENERIC_ERROR): Result => ({ ok: false, error });
