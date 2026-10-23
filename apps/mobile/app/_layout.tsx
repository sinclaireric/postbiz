import "@/global.css";
import "@/utils/suppress-warnings";

import { DefaultTheme, type Theme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Image } from "expo-image";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { cssInterop } from "nativewind";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";

import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AppDataSync } from "@/components/app-data-sync";
import { ConfigMissingScreen } from "@/components/ui/config-missing-screen";
import { CreateOrganizationScreen } from "@/components/ui/create-organization-screen";
import { ToastProvider } from "@/components/ui/toast";
import { resetAllStores } from "@/lib/reset-stores";
import { useAuthLinks } from "@/lib/use-auth-links";
import { DEMO } from "@/lib/demo";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";

const PostbizTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F8F7F4",
    card: "#F8F7F4",
    border: "#E7E5DF",
  },
};

cssInterop(Image, { className: "style" });
cssInterop(Ionicons, {
  className: {
    target: "style",
    nativeStyleToProp: { color: true },
  },
});

void SplashScreen.preventAutoHideAsync();
void SystemUI.setBackgroundColorAsync("#F8F7F4");

function FullScreenSpinner() {
  return (
    <View className="absolute inset-0 items-center justify-center bg-canvas">
      <ActivityIndicator color="#FC69FF" />
    </View>
  );
}

/** Navigation protégée par l'état de connexion, avec les écrans d'attente par-dessus (la pile reste montée). */
function AppNavigator() {
  const authStatus = useAuthStore((s) => s.status);
  const recovery = useAuthStore((s) => s.recovery);
  const orgStatus = useOrgStore((s) => s.status);
  const signedIn = authStatus === "signedIn" && !recovery;

  useAuthLinks();

  useEffect(() => {
    if (signedIn) void useOrgStore.getState().load();
    else resetAllStores();
  }, [signedIn]);

  const overlay = !isSupabaseConfigured && !DEMO ? (
    <ConfigMissingScreen />
  ) : authStatus === "loading" ? (
    <FullScreenSpinner />
  ) : signedIn && (orgStatus === "idle" || orgStatus === "loading") ? (
    <FullScreenSpinner />
  ) : signedIn && orgStatus === "empty" ? (
    <CreateOrganizationScreen />
  ) : signedIn && orgStatus === "error" ? (
    <CreateOrganizationScreen retryOnly />
  ) : null;

  return (
    <>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: "#F8F7F4" },
          freezeOnBlur: false,
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="post/[id]"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="conversation/[id]"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen name="notifications" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="channels" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="add-channel" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="account" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="media" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="create-post" options={{ headerShown: false, presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="enable-notifications" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
        </Stack.Protected>
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      </Stack>
      {signedIn && orgStatus === "ready" ? <AppDataSync /> : null}
      {overlay}
    </>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    PlusJakartaSans: require("@/assets/fonts/PlusJakartaSans.ttf"),
    "PlusJakartaSans-Italic": require("@/assets/fonts/PlusJakartaSans-Italic.ttf"),
  });

  useEffect(() => useAuthStore.getState().init(), []);

  useEffect(() => {
    if (loaded) {
      void SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView className="flex-1 bg-canvas">
      <SafeAreaProvider>
        <ThemeProvider value={PostbizTheme}>
          <ErrorBoundary>
              <ToastProvider>
                <AppNavigator />
                <StatusBar style="dark" />
              </ToastProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
