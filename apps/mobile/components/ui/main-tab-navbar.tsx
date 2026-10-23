import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "@/lib/haptics";
import { useInboxUnreadCount } from "@/store/inbox-store";

export type TabName = "agent" | "publish" | "community" | "insights";

type TabDef = { id: TabName; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap; href: string; path: string };

const TABS: TabDef[] = [
  { id: "agent", label: "Agent", icon: "sparkles-outline", activeIcon: "sparkles", href: "/(tabs)/agent", path: "/agent" },
  { id: "publish", label: "Publier", icon: "calendar-outline", activeIcon: "calendar", href: "/(tabs)", path: "/" },
  { id: "community", label: "Messages", icon: "chatbubbles-outline", activeIcon: "chatbubbles", href: "/(tabs)/inbox", path: "/inbox" },
  { id: "insights", label: "Insights", icon: "stats-chart-outline", activeIcon: "stats-chart", href: "/(tabs)/analytics", path: "/analytics" },
];

/** Hauteur occupée par la barre flottante (hors zone de sécurité) : les écrans l'ajoutent en bas de leur contenu. */
export const TAB_BAR_HEIGHT = 96;

const ACTIVE = "#2F4A00";
const MUTED = "#6B6B66";
const PAD = 8; // marge intérieure de la pilule
const FAB = 68;
const FAB_GAP = 12;

const tabForPath = (pathname: string): TabName | null => TABS.find((t) => (t.path === "/" ? pathname === "/" || pathname === "/index" : pathname === t.path || pathname.startsWith(`${t.path}/`)))?.id ?? null;

function TabButton({ tab, active, badge, onPress }: { tab: TabDef; active: boolean; badge: number; onPress: () => void }) {
  const scale = useSharedValue(active ? 1.12 : 1);
  useEffect(() => {
    scale.value = withSpring(active ? 1.14 : 1, { damping: 9, stiffness: 220 });
  }, [active, scale]);
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1, height: 56, alignItems: "center", justifyContent: "center", gap: 2 }}
    >
      <Animated.View style={icon}>
        <Ionicons name={active ? tab.activeIcon : tab.icon} size={22} color={active ? ACTIVE : "#141414"} />
        {badge > 0 ? (
          <View className="absolute -right-2 -top-1 min-w-[16px] items-center rounded-full bg-ink px-1">
            <Text className="font-jakarta text-[10px] font-bold text-white">{badge > 99 ? "99+" : badge}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Text numberOfLines={1} className="font-jakarta text-[10px] font-semibold" style={{ color: active ? ACTIVE : MUTED }}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

/**
 * Barre du bas flottante, montée une seule fois dans le layout des onglets : la pastille de l'onglet actif glisse d'un onglet
 * à l'autre, et le bouton rond « nouvelle publication » n'apparaît (en s'animant) que sur l'onglet Publier.
 */
export function FloatingTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { bottom } = useSafeAreaInsets();
  const inboxUnread = useInboxUnreadCount();

  // Quand un écran est poussé par-dessus les onglets (aperçu, conversation…), on garde le dernier onglet connu.
  const lastTab = useRef<TabName>("publish");
  const current = tabForPath(pathname);
  if (current) lastTab.current = current;
  const active = lastTab.current;
  const index = TABS.findIndex((t) => t.id === active);

  const [barWidth, setBarWidth] = useState(0);
  const slideX = useSharedValue(0);
  const tabW = barWidth > 0 ? (barWidth - PAD * 2) / TABS.length : 0;

  useEffect(() => {
    if (tabW === 0) return;
    slideX.value = withSpring(index * tabW, { damping: 17, stiffness: 190, mass: 0.9 });
  }, [index, tabW, slideX]);

  const showFab = active === "publish";
  const fab = useSharedValue(showFab ? 1 : 0);
  useEffect(() => {
    fab.value = withTiming(showFab ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [showFab, fab]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: slideX.value }] }));
  // Le bouton se replie (largeur → 0) pour que la pilule reprenne toute la largeur ; il s'efface et rétrécit en même temps.
  const fabBox = useAnimatedStyle(() => ({ width: fab.value * (FAB + FAB_GAP), opacity: fab.value, overflow: "hidden" }));
  const fabButton = useAnimatedStyle(() => ({ transform: [{ scale: 0.4 + 0.6 * fab.value }, { rotate: `${(1 - fab.value) * -90}deg` }] }));
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const go = (tab: TabDef) => {
    if (tab.id === active) return;
    haptic.select();
    router.navigate(tab.href as never);
  };

  return (
    <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0 flex-row items-center px-3" style={{ paddingBottom: Math.max(bottom, 8) + 4 }}>
      <View
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        className="h-[68px] flex-1 flex-row items-center rounded-full bg-card"
        style={{ paddingHorizontal: PAD, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10 }}
      >
        {tabW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", left: PAD, top: 6, bottom: 6, width: tabW, borderRadius: 999, backgroundColor: "#EFEDE7" }, indicator]}
          />
        ) : null}
        {TABS.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={tab.id === active} badge={tab.id === "community" ? inboxUnread : 0} onPress={() => go(tab)} />
        ))}
      </View>

      <Animated.View style={[{ marginLeft: 0, height: FAB, alignItems: "flex-end", justifyContent: "center" }, fabBox]} pointerEvents={showFab ? "auto" : "none"}>
        <Animated.View style={[{ width: FAB, height: FAB, marginLeft: FAB_GAP }, fabButton]}>
          <Animated.View style={pressStyle}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nouvelle publication"
              onPress={() => {
                haptic.medium();
                router.push("/create-post");
              }}
              onPressIn={() => (press.value = withTiming(0.92, { duration: 90 }))}
              onPressOut={() => (press.value = withSpring(1, { damping: 8, stiffness: 260 }))}
              style={{
                width: FAB,
                height: FAB,
                borderRadius: FAB / 2,
                backgroundColor: "#C6F432",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#7DA300",
                shadowOpacity: 0.35,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 5 },
                elevation: 10,
              }}
            >
              <Ionicons name="add" size={34} color="#141414" />
            </Pressable>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
