import { create } from "zustand";

import { DEMO } from "@/lib/demo";
import { supabase } from "@/lib/supabase";
import {
  cleanSupportBody,
  mergeSupportMessages,
  parseSupportMessage,
  SUPPORT_ERROR_TEXT,
  SUPPORT_THREAD_LIMIT,
  supportErrorCode,
  validateSupportBody,
  type SupportMessage,
  type SupportStatus,
} from "@/lib/support-logic";

type SendResult = { ok: true } | { ok: false; error: string };

type SupportState = {
  conversationId: string | null;
  status: SupportStatus;
  /** Réponses du support que la personne n'a pas encore lues. */
  unread: number;
  /** Du plus ancien au plus récent. */
  messages: SupportMessage[];
  loaded: boolean;
  /** Vrai si le dernier chargement a échoué (l'écran le dit, sans effacer ce qui est déjà affiché). */
  error: boolean;

  load: (userId: string) => Promise<void>;
  send: (body: string, orgId: string | null) => Promise<SendResult>;
  markRead: () => Promise<void>;
  reset: () => void;
};

const EMPTY = { conversationId: null, status: "open" as SupportStatus, unread: 0, messages: [] as SupportMessage[], loaded: false, error: false };

/**
 * Chat de support : lectures sous la RLS (la conversation de la personne seulement, aucune adresse e-mail), écritures par les fonctions `support_send` et
 * `support_mark_read` de la base (limite de débit, taille et nettoyage du texte y sont appliqués). En mode démo : tout reste en mémoire, rien n'est envoyé.
 */
export const useSupportStore = create<SupportState>((set, get) => ({
  ...EMPTY,

  load: async (userId) => {
    if (DEMO) {
      set({ loaded: true, error: false });
      return;
    }
    const { data: conversation, error } = await supabase.from("support_conversations").select("id, status, user_unread").eq("user_id", userId).maybeSingle();
    if (error) {
      set({ loaded: true, error: true });
      return;
    }
    if (!conversation) {
      set({ ...EMPTY, loaded: true });
      return;
    }
    const { data: rows, error: messagesError } = await supabase
      .from("support_messages")
      .select("id, author, body, created_at")
      .eq("conversation_id", conversation.id as string)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SUPPORT_THREAD_LIMIT);
    if (messagesError) {
      set({ loaded: true, error: true });
      return;
    }
    set((s) => ({
      loaded: true,
      error: false,
      conversationId: conversation.id as string,
      status: conversation.status === "resolved" ? "resolved" : "open",
      unread: typeof conversation.user_unread === "number" ? conversation.user_unread : 0,
      messages: mergeSupportMessages(s.conversationId === conversation.id ? s.messages : [], (rows ?? []).flatMap((r) => parseSupportMessage(r) ?? [])),
    }));
  },

  send: async (body, orgId) => {
    const clean = cleanSupportBody(body);
    const invalid = validateSupportBody(clean);
    if (invalid) return { ok: false, error: SUPPORT_ERROR_TEXT[invalid] };

    if (DEMO) {
      const at = new Date().toISOString();
      const mine: SupportMessage = { id: `demo-${Date.now()}`, author: "user", body: clean, createdAt: at };
      const reply: SupportMessage = {
        id: `demo-reply-${Date.now()}`,
        author: "support",
        body: "Mode démonstration : ce message n’est transmis à personne. Avec un vrai compte, l’équipe Postbiz vous répond ici et vous prévient par une notification.",
        createdAt: new Date(Date.now() + 1).toISOString(),
      };
      set((s) => ({ conversationId: s.conversationId ?? "demo-support", status: "open", messages: mergeSupportMessages(s.messages, [mine, reply]) }));
      return { ok: true };
    }

    const { error } = await supabase.rpc("support_send", { p_body: clean, p_org: orgId });
    if (error) return { ok: false, error: SUPPORT_ERROR_TEXT[supportErrorCode(error)] };
    const user = (await supabase.auth.getUser()).data.user;
    if (user) await get().load(user.id);
    return { ok: true };
  },

  markRead: async () => {
    if (get().unread === 0) return;
    set({ unread: 0 });
    if (DEMO) return;
    // L'échec n'est pas grave : le compteur sera relu au prochain chargement.
    await supabase.rpc("support_mark_read");
  },

  reset: () => set({ ...EMPTY }),
}));
