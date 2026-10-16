import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { AuthInput } from "@/components/ui/auth-input";
import { showToast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";

function PasswordVisibilityToggle({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
    >
      {visible ? (
        <Ionicons name="eye-outline" size={20} className="text-icon-secondary" />
      ) : (
        <Image
          source={require("@/assets/icons/login/eye-slash.svg")}
          className="h-5 w-5"
          contentFit="contain"
        />
      )}
    </Pressable>
  );
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const [busy, setBusy] = useState(false);
  const recovery = useAuthStore((state) => state.recovery);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);

  const handleTogglePassword = () => {
    const wasFocused = passwordInputRef.current?.isFocused() ?? false;
    setPasswordVisible((prev) => !prev);
    if (wasFocused) {
      requestAnimationFrame(() => {
        passwordInputRef.current?.focus();
      });
    }
  };

  const handleToggleConfirmPassword = () => {
    const wasFocused = confirmPasswordInputRef.current?.isFocused() ?? false;
    setConfirmPasswordVisible((prev) => !prev);
    if (wasFocused) {
      requestAnimationFrame(() => {
        confirmPasswordInputRef.current?.focus();
      });
    }
  };

  const handleResetPassword = async () => {
    const newErrors: { password?: string; confirmPassword?: string } = {};
    if (!password || password.length < 8) newErrors.password = "8 caractères minimum";
    if (!confirmPassword) newErrors.confirmPassword = "Confirmez votre mot de passe";
    else if (password !== confirmPassword) newErrors.confirmPassword = "Les mots de passe ne correspondent pas";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setBusy(true);
    const result = await useAuthStore.getState().updatePassword(password);
    setBusy(false);
    if (!result.ok) {
      setErrors({ password: result.error });
      return;
    }
    // La session ouverte par le lien devient la session normale : les routes protégées ouvrent l'application.
    showToast("Mot de passe modifié", "success");
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

          <View className="mb-6 w-full">
            <Pressable
              className="h-6 w-6 items-center justify-center"
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={20} className="text-icon-primary" />
            </Pressable>
          </View>

          <View className="gap-8">
            <View className="gap-3">
              <Text className="font-jakarta text-2xl font-semibold leading-8 text-text-primary">
                Nouveau mot de passe
              </Text>
              <Text className="font-jakarta text-sm text-text-secondary">
                Choisissez un mot de passe d’au moins 8 caractères.
              </Text>
            </View>

            <View className="gap-5">
              <AuthInput
                ref={passwordInputRef}
                label="Mot de passe"
                value={password}
                onChangeText={(text) => { setPassword(text); if (errors.password) setErrors((prev) => ({ ...prev, password: undefined })); }}
                placeholder="Nouveau mot de passe"
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
                  <PasswordVisibilityToggle
                    visible={passwordVisible}
                    onPress={handleTogglePassword}
                  />
                }
              />

              <AuthInput
                ref={confirmPasswordInputRef}
                label="Confirmer le mot de passe"
                value={confirmPassword}
                onChangeText={(text) => { setConfirmPassword(text); if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: undefined })); }}
                placeholder="Confirmez le mot de passe"
                secureTextEntry={!confirmPasswordVisible}
                textContentType="none"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                smartInsertDelete={false}
                keyboardType={Platform.OS === "ios" ? "ascii-capable" : "default"}
                error={!!errors.confirmPassword}
                hint={errors.confirmPassword}
                rightSlot={
                  <PasswordVisibilityToggle
                    visible={confirmPasswordVisible}
                    onPress={handleToggleConfirmPassword}
                  />
                }
              />
            </View>

            {recovery ? (
              <AppButton
                label={busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
                variant={busy ? "disabled" : "primary"}
                disabled={busy}
                onPress={handleResetPassword}
              />
            ) : (
              <Text className="font-jakarta text-sm text-text-secondary">
                Ouvrez le lien reçu par e-mail sur cet appareil pour choisir un nouveau mot de passe.
              </Text>
            )}
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}
