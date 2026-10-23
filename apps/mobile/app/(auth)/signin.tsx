import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, View, type TextInputInstance } from "react-native";

import { AuthShell } from "@/components/ui/auth-shell";
import { Field, PasswordField } from "@/components/ui/field";
import { PrimaryButton } from "@/components/ui/kit";
import { useAuthStore } from "@/store/auth-store";

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    const next: { email?: string; password?: string } = {};
    if (!email || !email.includes("@")) next.email = "Adresse e-mail incorrecte";
    if (!password) next.password = "Saisissez votre mot de passe";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    const result = await useAuthStore.getState().signIn(email, password);
    setBusy(false);
    // En cas de succès, la navigation est faite par les routes protégées (app/_layout.tsx).
    if (!result.ok) setErrors({ password: result.error });
  };

  return (
    <AuthShell
      title="Bon retour"
      subtitle="Connectez-vous pour retrouver vos publications et vos messages."
      footer={
        <>
          <PrimaryButton label="Se connecter" onPress={submit} loading={busy} />
          <View className="flex-row justify-center gap-2">
            <Text className="font-jakarta text-[14px] text-ink-soft">Pas encore de compte ?</Text>
            <Pressable onPress={() => router.replace("/(auth)/signup")}>
              <Text className="font-jakarta text-[14px] font-semibold text-ink underline">Créer un compte</Text>
            </Pressable>
          </View>
        </>
      }
    >
      <Field
        label="E-mail"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
        }}
        placeholder="vous@entreprise.fr"
        keyboardType="email-address"
        error={!!errors.email}
        hint={errors.email}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <PasswordField
        ref={passwordRef}
        label="Mot de passe"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
        }}
        placeholder="Votre mot de passe"
        error={!!errors.password}
        hint={errors.password}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Pressable className="self-end py-1" onPress={() => router.push("/(auth)/forgot-password")}>
        <Text className="font-jakarta text-[14px] font-semibold text-ink underline">Mot de passe oublié ?</Text>
      </Pressable>
    </AuthShell>
  );
}
