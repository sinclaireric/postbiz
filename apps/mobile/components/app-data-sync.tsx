import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { DEMO } from "@/lib/demo";
import { seedDemoData } from "@/lib/demo-seed";
import { getPref } from "@/lib/prefs";
import { getPushPermission, registerForPush, routeForNotificationData } from "@/lib/push";
import { useRealtime } from "@/lib/use-realtime";
import { useAuthStore } from "@/store/auth-store";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useNotificationsStore } from "@/store/notifications-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";
import { useSupportStore } from "@/store/support-store";

/** Monté une fois connecté et l'organisation chargée : charge les données, ouvre Realtime, enregistre le jeton push. */
export function AppDataSync() {
  const router = useRouter();
  const orgId = useOrgStore((s) => s.current?.id);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!orgId || !userId) return;
    if (DEMO) {
      seedDemoData();
      return;
    }
    void useChannelsStore.getState().load(orgId);
    void usePostsStore.getState().load(orgId);
    void useInboxStore.getState().load(orgId);
    void useNotificationsStore.getState().load(userId);
    void useSupportStore.getState().load(userId);
    // Autorisation déjà donnée : on enregistre le jeton. Jamais demandée : écran d'explication d'abord (une seule fois),
    // plutôt que la fenêtre système sans contexte.
    void (async () => {
      const permission = await getPushPermission();
      if (permission === "granted") await registerForPush(userId);
      else if (permission === "undetermined" && (await getPref("postbiz.push-prompt")) !== "seen") router.push("/enable-notifications" as never);
    })().catch((e) => console.warn("[push]", e));
  }, [orgId, userId]);

  return (
    <>
      {Platform.OS !== "web" ? <NotificationTaps /> : null}
      {orgId && userId && !DEMO ? <RealtimeBinding orgId={orgId} userId={userId} /> : null}
    </>
  );
}

/** Toucher une notification (app ouverte, en arrière-plan ou fermée) ouvre l'écran concerné. Pas disponible sur le web. */
function NotificationTaps() {
  const router = useRouter();
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
  return null;
}

function RealtimeBinding({ orgId, userId }: { orgId: string; userId: string }) {
  useRealtime(orgId, userId);
  return null;
}
