import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";

import { AUTH_REDIRECT_URL } from "@/lib/auth-redirect";
import { authErrorMessage, fail, ok, type Result } from "@/lib/errors";
import { unregisterPushToken } from "@/lib/push";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Vrai entre l'ouverture d'un lien « mot de passe oublié » et le choix du nouveau mot de passe. */
  recovery: boolean;
  /** Erreur d'un lien d'e-mail invalide ou expiré, affichée par l'écran auth-callback. */
  linkError: string | null;

  init: () => () => void;
  setRecovery: (value: boolean) => void;
  setLinkError: (message: string | null) => void;
  signIn: (email: string, password: string) => Promise<Result>;
  /** `needsConfirmation` : Supabase attend le clic sur le lien reçu par e-mail avant de créer la session. */
  signUp: (email: string, password: string, company: string) => Promise<Result & { needsConfirmation?: boolean }>;
  sendPasswordReset: (email: string) => Promise<Result>;
  resendConfirmation: (email: string) => Promise<Result>;
  updatePassword: (password: string) => Promise<Result>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  session: null,
  user: null,
  recovery: false,
  linkError: null,

  init: () => {
    if (!isSupabaseConfigured) {
      set({ status: "signedOut" });
      return () => {};
    }
    void supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, user: data.session?.user ?? null, status: data.session ? "signedIn" : "signedOut" });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Pas d'appel Supabase directement dans ce callback (risque d'interblocage) : on ne fait que mettre à jour l'état.
      set({
        session,
        user: session?.user ?? null,
        status: session ? "signedIn" : "signedOut",
        recovery: session ? (event === "PASSWORD_RECOVERY" ? true : get().recovery) : false,
      });
    });
    return () => data.subscription.unsubscribe();
  },

  setRecovery: (value) => set({ recovery: value }),
  setLinkError: (message) => set({ linkError: message }),

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? fail(authErrorMessage(error)) : ok();
  },

  signUp: async (email, password, company) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // `company` sert à créer l'organisation à la première connexion (voir store/org-store.ts).
      options: { data: { company: company.trim() }, emailRedirectTo: AUTH_REDIRECT_URL },
    });
    if (error) return fail(authErrorMessage(error));
    return { ...ok(), needsConfirmation: !data.session };
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: AUTH_REDIRECT_URL });
    return error ? fail(authErrorMessage(error)) : ok();
  },

  resendConfirmation: async (email) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: AUTH_REDIRECT_URL },
    });
    return error ? fail(authErrorMessage(error)) : ok();
  },

  updatePassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return fail(authErrorMessage(error));
    set({ recovery: false });
    return ok();
  },

  signOut: async () => {
    // Le jeton push de cet appareil doit cesser de recevoir les notifications de ce compte.
    await unregisterPushToken().catch(() => {});
    await supabase.auth.signOut();
    set({ recovery: false });
  },
}));
