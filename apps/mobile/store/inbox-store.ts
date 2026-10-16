import { create } from "zustand";

import { replyWindow, validateReply } from "@/lib/inbox/logic";
import type { ConversationStatus, ConversationSummary, MessageItem, NetworkId } from "@/lib/inbox/types";
import { fail, GENERIC_ERROR, ok, type Result } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";

type Row = Record<string, any>;

const one = <T extends Row>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const CONVERSATION_COLUMNS =
  "id, kind, status, unread_count, last_message_at, last_message_preview, reply_window_expires_at, assignee_id, integrations(provider, name), contacts(name, username)";

async function profileNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? "Membre"]));
}

function toSummary(r: Row, names: Map<string, string>): ConversationSummary {
  const integ = one<Row>(r.integrations);
  const contact = one<Row>(r.contacts);
  return {
    id: r.id,
    networkId: (integ?.provider ?? "facebook") as NetworkId,
    accountName: integ?.name ?? "",
    kind: r.kind,
    contactName: contact?.name ?? contact?.username ?? "Contact inconnu",
    contactUsername: contact?.username ?? null,
    status: r.status,
    assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? "Membre") : null,
    unreadCount: r.unread_count ?? 0,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview ?? "",
    replyWindowExpiresAt: r.reply_window_expires_at ?? null,
  };
}

function toMessage(m: Row, names: Map<string, string>): MessageItem {
  return {
    id: m.id,
    direction: m.direction,
    body: m.body,
    attachments: m.attachments ?? [],
    sentByName: m.sent_by ? (names.get(m.sent_by) ?? "Membre") : null,
    deliveryStatus: m.delivery_status,
    error: m.error ?? null,
    createdAt: m.created_at,
  };
}

type InboxState = {
  conversations: ConversationSummary[];
  /** Messages des fils déjà ouverts, par conversation. */
  messages: Record<string, MessageItem[]>;
  loaded: boolean;
  error: string | null;

  load: (orgId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  /** Recharge le fil ouvert et la liste (appelé par Realtime). */
  refreshOpen: () => Promise<void>;
  setOpenConversation: (id: string | null) => void;
  sendReply: (conversationId: string, body: string) => Promise<Result>;
  setStatus: (conversationId: string, status: ConversationStatus) => Promise<Result>;
  markRead: (conversationId: string) => Promise<void>;
  reset: () => void;
};

let openConversationId: string | null = null;

export const useInboxStore = create<InboxState>((set, get) => ({
  conversations: [],
  messages: {},
  loaded: false,
  error: null,

  load: async (orgId) => {
    const { data, error } = await supabase
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("org_id", orgId)
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error || !data) {
      set({ error: "Impossible de charger la boîte de réception.", loaded: true });
      return;
    }
    const names = await profileNames(data.map((r) => r.assignee_id as string | null));
    set({ conversations: data.map((r) => toSummary(r, names)), loaded: true, error: null });
  },

  loadMessages: async (conversationId) => {
    const { data, error } = await supabase
      .from("messages")
      .select("id, direction, body, attachments, sent_by, delivery_status, error, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error || !data) return;
    const names = await profileNames(data.map((m) => m.sent_by as string | null));
    set((s) => ({ messages: { ...s.messages, [conversationId]: data.map((m) => toMessage(m, names)) } }));
  },

  setOpenConversation: (id) => {
    openConversationId = id;
  },

  refreshOpen: async () => {
    const org = useOrgStore.getState().current;
    const tasks: Promise<void>[] = [];
    if (org) tasks.push(get().load(org.id));
    if (openConversationId) tasks.push(get().loadMessages(openConversationId));
    await Promise.all(tasks);
  },

  sendReply: async (conversationId, body) => {
    const org = useOrgStore.getState().current;
    const user = useAuthStore.getState().user;
    if (!org || !user) return fail("Session expirée. Reconnectez-vous.");
    if (!useOrgStore.getState().canWrite) return fail("Votre rôle ne permet pas de répondre.");

    // Même contrôle que sur le web : la fenêtre de 24 h est lue sur la conversation, pas sur l'horloge de l'appareil seule.
    const { data: c } = await supabase
      .from("conversations")
      .select("reply_window_expires_at")
      .eq("id", conversationId)
      .eq("org_id", org.id)
      .maybeSingle();
    if (!c) return fail("Conversation introuvable.");
    const invalid = validateReply(body, replyWindow(c.reply_window_expires_at));
    if (invalid) return fail(invalid);

    // Le message est mis en file (« queued ») ; le worker l'envoie puis le passe à « sent » ou « failed » (Realtime nous le dit).
    const { error } = await supabase.from("messages").insert({
      org_id: org.id,
      conversation_id: conversationId,
      direction: "out",
      body: body.trim(),
      sent_by: user.id,
      delivery_status: "queued",
    });
    if (error) return fail(GENERIC_ERROR);
    await get().loadMessages(conversationId);
    return ok();
  },

  setStatus: async (conversationId, status) => {
    const prev = get().conversations;
    set({ conversations: prev.map((c) => (c.id === conversationId ? { ...c, status } : c)) });
    const { data, error } = await supabase.from("conversations").update({ status }).eq("id", conversationId).select("id");
    if (error || !data || data.length === 0) {
      set({ conversations: prev });
      return fail(error ? GENERIC_ERROR : "Votre rôle ne permet pas de modifier cette conversation.");
    }
    return ok();
  },

  markRead: async (conversationId) => {
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (!conv || conv.unreadCount === 0) return;
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)) }));
    await supabase.from("conversations").update({ unread_count: 0 }).eq("id", conversationId);
  },

  reset: () => {
    openConversationId = null;
    set({ conversations: [], messages: {}, loaded: false, error: null });
  },
}));

export const useInboxUnreadCount = () =>
  useInboxStore((s) => s.conversations.reduce((n, c) => n + (c.status === "closed" ? 0 : c.unreadCount), 0));
