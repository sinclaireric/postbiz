import { create } from "zustand";

import { supabase } from "@/lib/supabase";
import type { NotificationItem } from "@/types";

type NotificationsState = {
  items: NotificationItem[];
  loaded: boolean;
  error: string | null;

  load: (userId: string) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  reset: () => void;
};

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loaded: false,
  error: null,

  load: async (userId) => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, data, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      set({ error: "Impossible de charger les notifications.", loaded: true });
      return;
    }
    set({
      loaded: true,
      error: null,
      items: (data ?? []).map((n) => ({
        id: n.id as string,
        type: n.type as string,
        title: n.title as string,
        body: (n.body as string | null) ?? null,
        data: (n.data as Record<string, unknown> | null) ?? {},
        createdAt: n.created_at as string,
        unread: n.read_at === null,
      })),
    });
  },

  markAsRead: async (id) => {
    const previous = get().items;
    if (!previous.some((n) => n.id === id && n.unread)) return;
    set({ items: previous.map((n) => (n.id === id ? { ...n, unread: false } : n)) });
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) set({ items: previous });
  },

  markAllAsRead: async () => {
    const previous = get().items;
    const unreadIds = previous.filter((n) => n.unread).map((n) => n.id);
    if (unreadIds.length === 0) return;
    set({ items: previous.map((n) => ({ ...n, unread: false })) });
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
    if (error) set({ items: previous });
  },

  reset: () => set({ items: [], loaded: false, error: null }),
}));

export const useUnreadCount = () => useNotificationsStore((state) => state.items.filter((n) => n.unread).length);
