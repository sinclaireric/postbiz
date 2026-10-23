import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { ClaudeMark, NETWORK_COLOR, NetworkGlyph, OpenAIMark } from "@/components/ui/brand-icon";
import { OutlineButton, PrimaryButton } from "@/components/ui/kit";
import type { ChannelNetwork } from "@/types";

type Floater = {
  id: string;
  /** Position du coin haut-gauche, en pourcentage de l'écran (peut sortir de l'écran : l'effet « débordant »). */
  x: number;
  y: number;
  size: number;
  tilt: number;
  node: { kind: "network"; network: ChannelNetwork } | { kind: "claude" } | { kind: "openai" };
};

// Réseaux pris en charge + marques d'IA (le côté « agent »). Zone haute au-dessus du titre, zone basse sous le sous-titre.
const FLOATERS: Floater[] = [
  { id: "claude", x: 0.36, y: 0.045, size: 68, tilt: -6, node: { kind: "claude" } },
  { id: "tiktok", x: 0.88, y: 0.1, size: 60, tilt: 8, node: { kind: "network", network: "tiktok" } },
  { id: "openai", x: -0.05, y: 0.17, size: 64, tilt: 10, node: { kind: "openai" } },
  { id: "x", x: 0.66, y: 0.2, size: 54, tilt: -8, node: { kind: "network", network: "x" } },
  { id: "linkedin", x: 0.04, y: 0.58, size: 64, tilt: -5, node: { kind: "network", network: "linkedin" } },
  { id: "facebook", x: 0.82, y: 0.59, size: 66, tilt: 7, node: { kind: "network", network: "facebook" } },
  { id: "instagram", x: 0.56, y: 0.655, size: 66, tilt: -4, node: { kind: "network", network: "instagram" } },
  { id: "youtube", x: 0.1, y: 0.675, size: 62, tilt: 9, node: { kind: "network", network: "youtube" } },
];

function FloatingIcon({ f, index, width, height }: { f: Floater; index: number; width: number; height: number }) {
  const drift = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    // Flottement continu, avec une durée et un sens différents par icône pour que l'ensemble reste vivant.
    const amp = 7 + (index % 3) * 2;
    const duration = 2400 + index * 260;
    drift.value = withDelay(
      600 + index * 90,
      withRepeat(withSequence(withTiming(-amp, { duration, easing: Easing.inOut(Easing.sin) }), withTiming(amp, { duration, easing: Easing.inOut(Easing.sin) })), -1, true),
    );
    scale.value = withDelay(900 + index * 90, withRepeat(withSequence(withTiming(1.04, { duration: duration * 1.3 }), withTiming(0.97, { duration: duration * 1.3 })), -1, true));
  }, [drift, scale, index]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: drift.value }, { scale: scale.value }, { rotate: `${f.tilt}deg` }] }));

  const inner =
    f.node.kind === "claude" ? (
      <ClaudeMark size={f.size * 0.58} />
    ) : f.node.kind === "openai" ? (
      <OpenAIMark size={f.size * 0.58} />
    ) : (
      <NetworkGlyph network={f.node.network} size={f.size * 0.46} color={NETWORK_COLOR[f.node.network] ?? "#111"} />
    );

  return (
    <Animated.View
      entering={ZoomIn.delay(150 + index * 90).springify().damping(12)}
      style={{ position: "absolute", left: f.x * width, top: f.y * height }}
    >
      <Animated.View
        style={[
          {
            width: f.size,
            height: f.size,
            borderRadius: f.size * 0.24,
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#2A2A20",
            shadowOpacity: 0.12,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 5,
          },
          style,
        ]}
      >
        {inner}
      </Animated.View>
    </Animated.View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const lift = useSharedValue(40);

  useEffect(() => {
    lift.value = withSpring(0, { damping: 16 });
  }, [lift]);

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />

      {FLOATERS.map((f, i) => (
        <FloatingIcon key={f.id} f={f} index={i} width={width} height={height} />
      ))}

      <View style={{ position: "absolute", left: 0, right: 0, top: height * 0.285, paddingHorizontal: 24 }}>
        <Animated.View entering={FadeInDown.delay(350).duration(600)}>
          <Text className="text-center font-jakarta text-[29px] font-semibold leading-[37px] text-ink">
            Votre espace de travail pour les réseaux sociaux
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(520).duration(600)} style={{ marginTop: 18 }}>
          <Text className="text-center font-jakarta text-[15px] leading-[21px] text-ink-soft">Publiez, répondez et créez avec votre agent IA, sans le chaos</Text>
        </Animated.View>
      </View>

      <Animated.View
        entering={FadeInUp.delay(650).springify().damping(15)}
        style={{
          position: "absolute",
          bottom: 12,
          left: 16,
          right: 16,
          backgroundColor: "#FFFFFF",
          borderRadius: 32,
          paddingHorizontal: 24,
          paddingTop: 28,
          paddingBottom: 28,
          gap: 12,
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -4 },
          elevation: 6,
        }}
      >
        <PrimaryButton label="Rejoindre Postbiz" onPress={() => router.push("/(auth)/signup")} />
        <OutlineButton label="J’ai déjà un compte" onPress={() => router.push("/(auth)/signin" as never)} />
        <Text className="pt-1 text-center font-jakarta text-[11px] text-ink-muted">Facebook · Instagram · X · LinkedIn · TikTok · YouTube</Text>
      </Animated.View>
    </SafeAreaView>
  );
}
