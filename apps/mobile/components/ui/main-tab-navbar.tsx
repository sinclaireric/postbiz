import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useInboxUnreadCount } from "@/store/inbox-store";

export type TabName = "agent" | "publish" | "community" | "insights";

type TabDef = { id: TabName; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap; href: string };

const TABS: TabDef[] = [
  { id: "agent", label: "Agent", icon: "sparkles-outline", activeIcon: "sparkles", href: "/(tabs)/agent" },
  { id: "publish", label: "Publier", icon: "calendar-outline", activeIcon: "calendar", href: "/(tabs)" },
  { id: "community", label: "Messages", icon: "chatbubbles-outline", activeIcon: "chatbubbles", href: "/(tabs)/inbox" },
  { id: "insights", label: "Insights", icon: "stats-chart-outline", activeIcon: "stats-chart", href: "/(tabs)/analytics" },
];

/** Hauteur occupée par la barre flottante (hors zone de sécurité) : les écrans l'ajoutent en bas de leur contenu. */
export const TAB_BAR_HEIGHT = 96;

const ACTIVE = "#2F4A00";
const MUTED = "#6B6B66";

/**
 * Barre du bas flottante : quatre onglets dans une pilule blanche, et à droite le bouton rond « nouvelle publication ».
 * Positionnée en absolu au-dessus du contenu.
 */
export function MainTabNavbar({ activeTab }: { activeTab: TabName }) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const inboxUnread = useInboxUnreadCount();

  const go = (tab: TabDef) => {
    if (tab.id === activeTab) return;
    if (Platform.OS === "ios") void Haptics.selectionAsync();
    router.replace(tab.href as never);
  };

  return (
    <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0 flex-row items-center gap-3 px-3" style={{ paddingBottom: Math.max(bottom, 8) + 4 }}>
      <View
        className="h-[68px] flex-1 flex-row items-center rounded-full bg-card px-2"
        style={{ shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10 }}
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          const badge = tab.id === "community" ? inboxUnread : 0;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              onPress={() => go(tab)}
              className={`h-[56px] flex-1 items-center justify-center gap-[2px] rounded-full ${active ? "bg-chip-bg" : ""}`}
            >
              <View>
                <Ionicons name={active ? tab.activeIcon : tab.icon} size={22} color={active ? ACTIVE : "#141414"} />
                {badge > 0 ? (
                  <View className="absolute -right-2 -top-1 min-w-[16px] items-center rounded-full bg-ink px-1">
                    <Text className="font-jakarta text-[10px] font-bold text-white">{badge > 99 ? "99+" : badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} className="font-jakarta text-[11px] font-semibold" style={{ color: active ? ACTIVE : MUTED }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nouvelle publication"
        onPress={() => router.push("/create-post")}
        className="h-[68px] w-[68px] items-center justify-center rounded-full bg-brand"
        style={{ shadowColor: "#7DA300", shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 10 }}
      >
        <Ionicons name="add" size={34} color="#141414" />
      </Pressable>
    </View>
  );
}
