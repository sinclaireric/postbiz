import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppButton } from "@/components/ui/app-button";
import { NETWORK_CONFIG } from "@/constants/networks";

/** Adresse de l'application web (optionnelle) : EXPO_PUBLIC_WEB_URL. */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "";

export default function AddChannelScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(0);

  const doBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  // Animate out to the right, then actually pop the screen
  const animatedClose = useCallback(() => {
    translateX.value = withTiming(
      screenWidth,
      { duration: 280, easing: Easing.out(Easing.cubic) },
      () => {
        runOnJS(doBack)();
      },
    );
  }, [translateX, screenWidth, doBack]);

  // Intercept Android hardware back button to use our animated close
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      animatedClose();
      return true;
    });
    return () => sub.remove();
  }, [animatedClose]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>
      <SafeAreaView className="flex-1 bg-background-primary" edges={["top", "bottom"]}>
        <StatusBar style="light" />

        <View className="h-[60px] flex-row items-center justify-between px-4">
          <Pressable
            className="h-6 w-6 items-center justify-center"
            onPress={animatedClose}
          >
            <Ionicons name="chevron-back" size={20} className="text-icon-primary" />
          </Pressable>

          <Text className="font-jakarta text-[20px] font-semibold text-text-primary">
            Ajouter un canal
          </Text>

          <View className="h-6 w-6" />
        </View>

        <ScrollView
          className="flex-1 px-4"
          contentContainerClassName="gap-4 pb-5 pt-2"
          showsVerticalScrollIndicator={false}
        >
          <Text className="font-jakarta text-h4 font-semibold text-text-primary">
            Connexion depuis l’application web
          </Text>
          <Text className="font-jakarta text-body-1 text-text-secondary">
            Les comptes Facebook, Instagram, X, LinkedIn, TikTok et YouTube se connectent pour l’instant depuis
            Postbiz sur le web, car l’autorisation passe par chaque réseau. Une fois connectés, vos canaux
            apparaissent ici automatiquement.
          </Text>

          <View className="flex-row flex-wrap gap-2 py-2">
            {(["facebook", "instagram", "x", "linkedin", "tiktok", "youtube"] as const).map((network) => (
              <View
                key={network}
                className="h-10 w-10 items-center justify-center rounded-[6px]"
                style={{ backgroundColor: NETWORK_CONFIG[network].bg }}
              >
                <Ionicons name={NETWORK_CONFIG[network].icon} size={22} color="#FFFFFF" />
              </View>
            ))}
          </View>

          {WEB_URL ? <AppButton label="Ouvrir Postbiz sur le web" onPress={() => void Linking.openURL(WEB_URL)} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}
