import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { AuthInput } from "@/components/ui/auth-input";
import { useAuthStore } from "@/store/auth-store";

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    company?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

  const handleTogglePassword = () => {
    const wasFocused = passwordInputRef.current?.isFocused() ?? false;
    setPasswordVisible((prev) => !prev);
    if (wasFocused) {
      requestAnimationFrame(() => {
        passwordInputRef.current?.focus();
      });
    }
  };

  const handleCreateAccount = async () => {
    const newErrors: { email?: string; password?: string; company?: string } =
      {};
    if (!email || !email.includes("@")) newErrors.email = "Adresse e-mail incorrecte";
    if (!password || password.length < 8)
      newErrors.password = "8 caractères minimum";
    if (!company.trim()) newErrors.company = "Le nom de l’entreprise est requis";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    setBusy(true);
    const result = await useAuthStore.getState().signUp(email, password, company);
    setBusy(false);
    if (!result.ok) {
      setErrors({ email: result.error });
      return;
    }
    // Sans confirmation requise, la session existe déjà et les routes protégées prennent le relais.
    if (result.needsConfirmation) {
      router.replace({ pathname: "/(auth)/check-email", params: { email, flow: "signup" } } as never);
    }
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background-primary"
      edges={["top", "bottom"]}
    >
      <StatusBar style="light" />
      <ScrollView
        className="flex-1 bg-background-primary"
        contentContainerClassName="flex-grow px-5 pt-12 pb-[20px]"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
          <View className="mb-6 h-[27px] w-[84px]">
            <View className="absolute inset-0 right-[70.6%]">
              <Image
                source={require("@/assets/icons/login/postbiz-mark.svg")}
                className="w-[25px] h-[27px]"
                contentFit="contain"
              />
            </View>
            <View className="absolute top-[1.61%] bottom-[10.76%] left-[37.32%] right-0">
              <Image
                source={require("@/assets/icons/login/postbiz-wordmark.svg")}
                className="w-[53px] h-[24px]"
                contentFit="contain"
              />
            </View>
          </View>

          <View className="gap-5">
            <View className="relative gap-6">
              <Text className="font-jakarta text-2xl font-semibold leading-8 text-text-primary">
                Créer un compte
              </Text>
              <View
                pointerEvents="none"
                className="absolute top-7 z-20 left-[-8.25px]"
              >
                <Image
                  source={require("@/assets/icons/login/signup-doodle.svg")}
                  className="w-[153px] h-[13px]"
                  contentFit="contain"
                />
              </View>

              <View className="gap-5 pt-[7px]">
                

                <AuthInput
                  label="E-mail"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (errors.email)
                      setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  placeholder="Votre adresse e-mail"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  error={!!errors.email}
                  hint={errors.email}
                />

                <AuthInput
                  ref={passwordInputRef}
                  label="Mot de passe"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (errors.password)
                      setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  placeholder="8 caractères minimum"
                  secureTextEntry={!passwordVisible}
                  textContentType="none"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  smartInsertDelete={false}
                  keyboardType={Platform.OS === "ios" ? "ascii-capable" : "default"}
                  error={!!errors.password}
                  hint={errors.password}
                  rightSlot={
                    <Pressable
                      onPress={handleTogglePassword}
                      hitSlop={10}
                    >
                      {passwordVisible ? (
                        <Ionicons
                          name="eye-outline"
                          size={20}
                          className="text-icon-secondary"
                        />
                      ) : (
                        <Image
                          source={require("@/assets/icons/login/eye-slash.svg")}
                          className="w-5 h-5"
                          contentFit="contain"
                        />
                      )}
                    </Pressable>
                  }
                />

                <AuthInput
                  label="Entreprise"
                  value={company}
                  onChangeText={(text) => {
                    setCompany(text);
                    if (errors.company)
                      setErrors((prev) => ({ ...prev, company: undefined }));
                  }}
                  placeholder="Nom de votre entreprise"
                  autoCapitalize="words"
                  error={!!errors.company}
                  hint={errors.company}
                />

              </View>
            </View>
          </View>

          <View className="mt-auto gap-6 pt-5">
            <View className="items-center pb-1">
              <Text className="w-full font-jakarta text-sm text-text-primary">
                En créant un compte, vous acceptez nos{" "}
                <Text className="underline" onPress={() => WebBrowser.openBrowserAsync("https://postbiz.com/cgu")}>conditions d’utilisation</Text> et notre{" "}
                <Text className="underline" onPress={() => WebBrowser.openBrowserAsync("https://postbiz.com/confidentialite")}>politique de confidentialité</Text>.
              </Text>
            </View>

            <AppButton
              label={busy ? "Création…" : "Créer mon compte"}
              variant={busy ? "disabled" : "primary"}
              disabled={busy}
              onPress={handleCreateAccount}
            />

            <View className="w-full flex-row items-baseline gap-2">
              <Text className="font-jakarta text-sm text-text-primary">
                Déjà un compte ?
              </Text>
              <Pressable onPress={() => router.replace("/(auth)")}>
                <Text className="font-jakarta text-[15px] font-semibold text-main-accent-pink">
                  Se connecter
                </Text>
              </Pressable>
            </View>
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}
