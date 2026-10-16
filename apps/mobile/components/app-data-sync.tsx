import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { registerForPush, routeForNotificationData } from "@/lib/push";
import { useRealtime } from "@/lib/use-realtime";
import { useAuthStore } from "@/store/auth-store";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useNotificationsStore } from "@/store/notifications-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";

/** Monté une fois connecté et l'organisation chargée : charge les données, ouvre Realtime, enregistre le jeton push. */
export function AppDataSync() {
  const router = useRouter();
  const orgId = useOrgStore((s) => s.current?.id);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!orgId || !userId) return;
    void useChannelsStore.getState().load(orgId);
    void usePostsStore.getState().load(orgId);
    void useInboxStore.getState().load(orgId);
    void useNotificationsStore.getState().load(userId);
    void registerForPush(userId).catch((e) => console.warn("[push]", e));
  }, [orgId, userId]);

  // Toucher une notification (app ouverte, en arrière-plan ou fermée) ouvre l'écran concerné.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!lastResponse) return;
    const key = `${lastResponse.notification.request.identifier}:${lastResponse.notification.date}`;
    if (handled.current === key) return;
    handled.current = key;
    const data = lastResponse.notification.request.content.data as Record<string, unknown> | undefined;
    router.push(routeForNotificationData(data) as never);
  }, [lastResponse, router]);

  return orgId && userId ? <RealtimeBinding orgId={orgId} userId={userId} /> : null;
}

function RealtimeBinding({ orgId, userId }: { orgId: string; userId: string }) {
  useRealtime(orgId, userId);
  return null;
}
