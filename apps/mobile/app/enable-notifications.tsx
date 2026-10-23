import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/ui/kit";
import { setPref } from "@/lib/prefs";
import { registerForPush } from "@/lib/push";
import { useAuthStore } from "@/store/auth-store";

/** Explication avant la demande système d'autorisation des notifications (proposée une seule fois après la première connexion). */
export default function EnableNotificationsScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await setPref("postbiz.push-prompt", "seen");
    router.back();
  };

  const enable = async () => {
    const userId = useAuthStore.getState().user?.id;
    setBusy(true);
    if (userId) await registerForPush(userId).catch(() => undefined);
    setBusy(false);
    await done();
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View className="flex-1 items-center justify-center gap-5 px-8">
        <View className="h-[96px] w-[96px] items-center justify-center rounded-full bg-brand-soft">
          <Ionicons name="notifications" size={44} color="#2F4A00" />
        </View>
        <Text className="text-center font-jakarta text-[24px] font-semibold text-ink">Restez informé(e)</Text>
        <Text className="text-center font-jakarta text-[15px] leading-[22px] text-ink">
          Nous pouvons vous prévenir quand un client vous écrit, quand une publication part ou quand elle échoue.
        </Text>
        <Text className="text-center font-jakarta text-[13.5px] leading-[19.5px] text-ink-soft">Vous pourrez désactiver les notifications à tout moment dans les paramètres.</Text>
      </View>
      <View className="gap-2 px-6 pb-4">
        <PrimaryButton label="Activer les notifications" onPress={enable} loading={busy} />
        <Pressable className="h-[52px] items-center justify-center" onPress={done}>
          <Text className="font-jakarta text-[15px] font-medium text-brand-ink">Ignorer</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
