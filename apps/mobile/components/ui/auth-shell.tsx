import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Appear } from "@/components/ui/kit";

/** Cadre commun des écrans de connexion : retour, titre, contenu défilant, pied de page fixe. */
export function AuthShell({ title, subtitle, children, footer, back = true }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; back?: boolean }) {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="h-[60px] justify-center px-4">
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retour"
              hitSlop={8}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(auth)"))}
              className="h-11 w-11 items-center justify-center rounded-full bg-card"
              style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
            >
              <Ionicons name="chevron-back" size={22} color="#141414" />
            </Pressable>
          ) : null}
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Appear index={0} style={{ gap: 12 }}>
            <Text className="font-jakarta text-[27px] font-semibold leading-[35px] text-ink">{title}</Text>
            {subtitle ? <Text className="font-jakarta text-[14.5px] leading-[21px] text-ink-soft">{subtitle}</Text> : null}
          </Appear>
          <Appear index={2} style={{ gap: 20 }}>
            {children}
          </Appear>
        </ScrollView>
        {footer ? <View className="gap-4 px-6 pb-4 pt-2">{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
