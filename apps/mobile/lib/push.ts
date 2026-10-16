import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

// Notifications affichées aussi quand l'app est au premier plan.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

export type PushStatus = "unsupported" | "denied" | "granted";

async function fetchExpoToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/**
 * Demande l'autorisation, récupère le jeton Expo et l'enregistre dans `push_tokens` (RLS : user_id = auth.uid()).
 * Ne fait rien sur le web ni sur simulateur (pas de jeton push). L'envoi des notifications est du ressort du serveur.
 */
export async function registerForPush(userId: string): Promise<PushStatus> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Postbiz",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return "denied";

  const token = await fetchExpoToken();
  if (!token) return "unsupported";
  registeredToken = token;

  // `token` est unique : si cet appareil est déjà enregistré pour ce compte, la ligne est simplement mise à jour.
  const { error } = await supabase
    .from("push_tokens")
    .upsert({ user_id: userId, token, platform: Platform.OS === "ios" ? "ios" : "android" }, { onConflict: "token" });
  if (error) console.warn("[push] enregistrement du jeton impossible :", error.message);
  return "granted";
}

/** À appeler avant la déconnexion : l'appareil ne doit plus recevoir les notifications de ce compte. */
export async function unregisterPushToken(): Promise<void> {
  if (Platform.OS === "web" || !Device.isDevice) return;
  const token = registeredToken ?? (await fetchExpoToken().catch(() => null));
  if (!token) return;
  await supabase.from("push_tokens").delete().eq("token", token);
  registeredToken = null;
}

export async function getPushPermission(): Promise<PushStatus> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "granted" : "denied";
}

/** Écran à ouvrir quand l'utilisateur touche une notification. La charge utile est posée par le serveur d'envoi. */
export function routeForNotificationData(data: Record<string, unknown> | undefined): string {
  const conversationId = data?.conversation_id;
  if (typeof conversationId === "string" && conversationId) return `/conversation/${conversationId}`;
  return "/notifications";
}
