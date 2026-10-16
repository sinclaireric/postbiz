import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { AuthInput } from "@/components/ui/auth-input";
import { useAuthStore } from "@/store/auth-store";

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {}
  );
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

  const handleSignIn = async () => {
    const newErrors: { email?: string; password?: string } = {};
    if (!email || !email.includes("@")) newErrors.email = "Adresse e-mail incorrecte";
    if (!password) newErrors.password = "Saisissez votre mot de passe";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    setBusy(true);
    const result = await useAuthStore.getState().signIn(email, password);
    setBusy(false);
    // En cas de succès, la navigation est faite par les routes protégées (app/_layout.tsx).
    if (!result.ok) setErrors({ password: result.error });
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background-primary"
      edges={["top", "bottom"]}
    >
      <StatusBar style="light" />
      <ScrollView
        className="flex-1 bg-background-primary px-5 pt-12 pb-[20px]"
        contentContainerClassName="flex-grow"
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

        <View className="gap-8">
          <View className="relative self-start">
            <View
              pointerEvents="none"
              className="absolute left-[-12px] top-[-2px]"
            >
              <Image
                source={require("@/assets/icons/login/title-scribble.svg")}
                className="w-[126px] h-[38px]"
                contentFit="contain"
              />
            </View>
            <Text className="font-jakarta text-2xl font-semibold leading-8 text-text-primary">
              Connexion
            </Text>
          </View>

          <View className="gap-5">
            

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
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="Votre mot de passe"
              secureTextEntry={!passwordVisible}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === "ios" ? "ascii-capable" : "default"}
              textContentType="none"
              autoComplete="off"
              spellCheck={false}
              smartInsertDelete={false}
              error={!!errors.password}
              hint={errors.password}
              rightSlot={
                <Pressable onPress={handleTogglePassword} hitSlop={10}>
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

            <View className="w-full items-end py-2">
              <Pressable onPress={() => router.push("/(auth)/forgot-password")}>
                <Text className="font-jakarta text-sm text-text-primary underline">
                  Mot de passe oublié ?
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className="mt-auto gap-6">
          <AppButton
            label={busy ? "Connexion…" : "Se connecter"}
            variant={busy ? "disabled" : "primary"}
            disabled={busy}
            onPress={handleSignIn}
          />

          <View className="flex-row items-baseline gap-2">
            <Text className="font-jakarta text-sm text-text-primary">
              Pas encore de compte ?
            </Text>
            <Pressable onPress={() => router.replace("/(auth)/signup")}>
              <Text className="font-jakarta text-[15px] font-semibold text-main-accent-pink">
                Créer un compte
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
