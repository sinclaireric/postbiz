import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AuthShell } from "@/components/ui/auth-shell";
import { OutlineButton, PrimaryButton } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";

/** Écran « regardez vos e-mails » : après une inscription (lien de confirmation) ou un mot de passe oublié (lien de réinitialisation). */
export default function CheckEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; flow?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const isSignup = params.flow === "signup";
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setBusy(true);
    const store = useAuthStore.getState();
    const result = isSignup ? await store.resendConfirmation(email) : await store.sendPasswordReset(email);
    setBusy(false);
    showToast(result.ok ? "E-mail renvoyé" : result.error, result.ok ? "success" : "error");
  };

  return (
    <AuthShell
      title="Vérifiez votre boîte mail"
      subtitle={
        (isSignup ? "Nous avons envoyé un lien de confirmation à " : "Si un compte existe pour cette adresse, un lien de réinitialisation a été envoyé à ") +
        (email ? `${email}.` : "votre adresse.") +
        "\n\nOuvrez le lien depuis ce téléphone pour continuer. Pensez à regarder dans les courriers indésirables."
      }
      footer={
        <>
          <PrimaryButton label="Renvoyer l’e-mail" onPress={resend} loading={busy} disabled={!email} />
          <OutlineButton label="Retour à la connexion" onPress={() => router.replace("/(auth)/signin" as never)} />
        </>
      }
    >
      <View className="h-[88px] w-[88px] items-center justify-center rounded-full bg-brand-soft">
        <Ionicons name="mail-open-outline" size={40} color="#2F4A00" />
      </View>
    </AuthShell>
  );
}
