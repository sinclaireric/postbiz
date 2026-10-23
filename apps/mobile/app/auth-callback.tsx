import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/ui/kit";
import { useAuthStore } from "@/store/auth-store";

/** Point d'arrivée des liens d'e-mail Supabase : lib/auth-links.ts ouvre la session, cet écran aiguille ensuite. */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const recovery = useAuthStore((s) => s.recovery);
  const linkError = useAuthStore((s) => s.linkError);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (status !== "signedIn") return;
    useAuthStore.getState().setLinkError(null);
    router.replace(recovery ? "/(auth)/reset-password" : "/(tabs)");
  }, [status, recovery, router]);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  const failed = linkError !== null || (timedOut && status !== "signedIn");

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View className="flex-1 items-center justify-center gap-6 px-8">
        {failed ? (
          <>
            <Text className="text-center font-jakarta text-h3 font-semibold text-ink">
              Lien invalide ou expiré
            </Text>
            <Text className="text-center font-jakarta text-body-1 text-ink-soft">
              {linkError ?? "Impossible d’ouvrir ce lien. Demandez-en un nouveau depuis l’écran de connexion."}
            </Text>
            <PrimaryButton
              label="Retour à la connexion"
              onPress={() => {
                useAuthStore.getState().setLinkError(null);
                router.replace("/(auth)/signin" as never);
              }}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color="#2F4A00" />
            <Text className="font-jakarta text-body-1 text-ink-soft">Connexion en cours…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
