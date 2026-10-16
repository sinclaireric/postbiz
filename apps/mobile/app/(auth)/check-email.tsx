import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { showToast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";

/** Écran « regardez vos e-mails » : après une inscription (lien de confirmation) ou un mot de passe oublié (lien de réinitialisation). */
export default function CheckEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; flow?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const isSignup = params.flow === "signup";
  const [busy, setBusy] = useState(false);

  const handleResend = async () => {
    setBusy(true);
    const store = useAuthStore.getState();
    const result = isSignup ? await store.resendConfirmation(email) : await store.sendPasswordReset(email);
    setBusy(false);
    showToast(result.ok ? "E-mail renvoyé" : result.error, result.ok ? "success" : "error");
  };

  return (
    <SafeAreaView className="flex-1 bg-background-primary" edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <ScrollView
        className="flex-1 bg-background-primary px-5 pt-12 pb-[20px]"
        contentContainerClassName="flex-grow"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-6 h-[27px] w-[84px]">
          <View className="absolute inset-0 right-[70.6%]">
            <Image source={require("@/assets/icons/login/postbiz-mark.svg")} className="w-[25px] h-[27px]" contentFit="contain" />
          </View>
          <View className="absolute top-[1.61%] bottom-[10.76%] left-[37.32%] right-0">
            <Image source={require("@/assets/icons/login/postbiz-wordmark.svg")} className="w-[53px] h-[24px]" contentFit="contain" />
          </View>
        </View>

        <View className="mb-6 w-full">
          <Pressable className="h-6 w-6 items-center justify-center" onPress={() => router.replace("/(auth)")}>
            <Ionicons name="chevron-back" size={20} className="text-icon-primary" />
          </Pressable>
        </View>

        <View className="gap-8">
          <View className="gap-3">
            <Text className="font-jakarta text-2xl font-semibold leading-8 text-text-primary">Vérifiez votre boîte mail</Text>
            <Text className="font-jakarta text-sm text-text-secondary">
              {isSignup
                ? "Nous avons envoyé un lien de confirmation à"
                : "Si un compte existe pour cette adresse, un lien de réinitialisation a été envoyé à"}
              {email ? ` ${email}.` : " votre adresse."}
              {"\n\n"}
              Ouvrez le lien depuis ce téléphone pour continuer. Pensez à regarder dans les courriers indésirables.
            </Text>
          </View>

          <AppButton
            label={busy ? "Envoi…" : "Renvoyer l’e-mail"}
            variant={busy || !email ? "disabled" : "primary"}
            disabled={busy || !email}
            onPress={handleResend}
          />
          <AppButton label="Retour à la connexion" variant="text" onPress={() => router.replace("/(auth)")} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
