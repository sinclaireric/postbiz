import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useNotificationsStore } from "@/store/notifications-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";

/** À la déconnexion : aucune donnée d'une organisation ne doit survivre en mémoire pour le compte suivant. */
export function resetAllStores() {
  useOrgStore.getState().reset();
  useChannelsStore.getState().reset();
  usePostsStore.getState().reset();
  useNotificationsStore.getState().reset();
  useInboxStore.getState().reset();
}
