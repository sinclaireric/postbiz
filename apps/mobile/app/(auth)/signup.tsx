import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, View, type TextInputInstance } from "react-native";

import { AuthShell } from "@/components/ui/auth-shell";
import { Field, PasswordField } from "@/components/ui/field";
import { PrimaryButton } from "@/components/ui/kit";
import { useAuthStore } from "@/store/auth-store";

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; company?: string }>({});
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const clear = (key: "email" | "password" | "company") => errors[key] && setErrors((e) => ({ ...e, [key]: undefined }));

  const submit = async () => {
    const next: { email?: string; password?: string; company?: string } = {};
    if (!company.trim()) next.company = "Le nom de l’entreprise est requis";
    if (!email || !email.includes("@")) next.email = "Adresse e-mail incorrecte";
    if (!password || password.length < 8) next.password = "8 caractères minimum";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    const result = await useAuthStore.getState().signUp(email, password, company);
    setBusy(false);
    if (!result.ok) {
      setErrors({ email: result.error });
      return;
    }
    // Sans confirmation requise, la session existe déjà et les routes protégées prennent le relais.
    if (result.needsConfirmation) router.replace({ pathname: "/(auth)/check-email", params: { email, flow: "signup" } } as never);
  };

  return (
    <AuthShell
      title="Créez votre compte"
      subtitle="Un espace pour planifier vos publications et répondre à tous vos messages."
      footer={
        <>
          <Text className="text-center font-jakarta text-[12px] leading-[18px] text-ink-soft">
            En créant un compte, vous acceptez nos{" "}
            <Text className="underline" onPress={() => WebBrowser.openBrowserAsync("https://www.getpostbiz.com/cgu")}>
              conditions d’utilisation
            </Text>{" "}
            et notre{" "}
            <Text className="underline" onPress={() => WebBrowser.openBrowserAsync("https://www.getpostbiz.com/confidentialite")}>
              politique de confidentialité
            </Text>
            .
          </Text>
          <PrimaryButton label="Créer mon compte" onPress={submit} loading={busy} />
          <View className="flex-row justify-center gap-2">
            <Text className="font-jakarta text-[14px] text-ink-soft">Déjà un compte ?</Text>
            <Pressable onPress={() => router.replace("/(auth)/signin" as never)}>
              <Text className="font-jakarta text-[14px] font-semibold text-ink underline">Se connecter</Text>
            </Pressable>
          </View>
        </>
      }
    >
      <Field
        label="Entreprise"
        value={company}
        onChangeText={(t) => {
          setCompany(t);
          clear("company");
        }}
        placeholder="Nom de votre entreprise"
        autoCapitalize="words"
        error={!!errors.company}
        hint={errors.company}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <Field
        ref={emailRef}
        label="E-mail"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          clear("email");
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
          clear("password");
        }}
        placeholder="8 caractères minimum"
        error={!!errors.password}
        hint={errors.password}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
    </AuthShell>
  );
}
