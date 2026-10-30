import { useEffect } from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useNotificationsStore } from "@/store/notifications-store";
import { usePostsStore } from "@/store/posts-store";
import { useSupportStore } from "@/store/support-store";

const DEBOUNCE_MS = 300;

/**
 * Supabase Realtime : la RLS s'applique aux événements, on ne reçoit que ce que l'utilisateur a le droit de lire.
 * Un événement déclenche un rechargement ciblé (plus simple et plus sûr que de recoller des lignes partielles).
 * Les tables concernées sont dans la publication `supabase_realtime` (migration 20261016000003_engine.sql).
 */
export function useRealtime(orgId: string, userId: string) {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const later = (key: string, fn: () => void) => {
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(fn, DEBOUNCE_MS));
    };

    const refreshPosts = () => later("posts", () => void usePostsStore.getState().load(orgId));
    const refreshInbox = () => later("inbox", () => void useInboxStore.getState().refreshOpen());
    const refreshSupport = () => later("support", () => void useSupportStore.getState().load(userId));
    const refreshNotifications = () => later("notifications", () => void useNotificationsStore.getState().load(userId));

    const channel = supabase
      .channel(`org:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `org_id=eq.${orgId}` }, refreshPosts)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `org_id=eq.${orgId}` }, refreshInbox)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `org_id=eq.${orgId}` }, refreshInbox)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, refreshNotifications)
      // Chat de support : la RLS ne livre que la conversation de la personne ; aucune adresse n'y figure.
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations", filter: `user_id=eq.${userId}` }, refreshSupport)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, refreshSupport)
      .subscribe();

    // Realtime ne rejoue pas ce qui s'est passé pendant que l'app dormait : on recharge au retour au premier plan.
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void usePostsStore.getState().load(orgId);
      void useChannelsStore.getState().load(orgId);
      void useInboxStore.getState().refreshOpen();
      void useNotificationsStore.getState().load(userId);
      void useSupportStore.getState().load(userId);
    });

    return () => {
      sub.remove();
      timers.forEach(clearTimeout);
      void supabase.removeChannel(channel);
    };
  }, [orgId, userId]);
}
