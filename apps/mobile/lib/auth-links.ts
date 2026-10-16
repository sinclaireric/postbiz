import { useAuthStore } from "@/store/auth-store";
import { parseLinkParams } from "@/lib/auth-params";
import { supabase } from "@/lib/supabase";

/**
 * Traite un lien venu d'un e-mail Supabase. Gère le flux implicite (access_token + refresh_token dans le fragment)
 * et le flux PKCE (?code=). Renvoie un message d'erreur, ou null si tout s'est bien passé / si le lien ne concerne pas l'auth.
 */
export async function handleAuthLink(url: string | null): Promise<string | null> {
  if (!url || !url.includes("auth-callback")) return null;
  const p = parseLinkParams(url);

  if (p.error || p.error_description) {
    return p.error_code === "otp_expired"
      ? "Ce lien a expiré. Demandez-en un nouveau."
      : "Ce lien n’est plus valide. Demandez-en un nouveau.";
  }

  const isRecovery = p.type === "recovery";

  if (p.access_token && p.refresh_token) {
    // Le mode « recovery » doit être connu avant que la session n'apparaisse, sinon l'app s'ouvrirait normalement.
    if (isRecovery) useAuthStore.getState().setRecovery(true);
    const { error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
    if (error) {
      useAuthStore.getState().setRecovery(false);
      return "Ce lien n’est plus valide. Demandez-en un nouveau.";
    }
    return null;
  }

  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    return error ? "Ce lien n’est plus valide. Demandez-en un nouveau." : null;
  }
  return null;
}
