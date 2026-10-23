import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { IconCircle } from "@/components/ui/kit";
import { Popover, useAnchor } from "@/components/ui/popover";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";
import { useUnreadCount } from "@/store/notifications-store";

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean };

/** Cloche des notifications + pastille du compte, dont le menu donne accès aux canaux, médias et réglages. */
export function HeaderActions() {
  const router = useRouter();
  const unread = useUnreadCount();
  const org = useOrgStore((s) => s.current);
  const email = useAuthStore((s) => s.user?.email);
  const { ref, anchor, open, close } = useAnchor();

  const go = (path: string) => () => {
    close();
    // Laisse la bulle se fermer avant de changer d'écran (sinon la modale reste affichée sur iOS).
    setTimeout(() => router.push(path as never), 120);
  };

  const rows: Row[] = [
    { icon: "settings-outline", label: "Paramètres du compte", onPress: go("/account") },
    { icon: "share-social-outline", label: "Canaux", onPress: go("/channels") },
    { icon: "images-outline", label: "Médias", onPress: go("/media") },
    {
      icon: "log-out-outline",
      label: "Se déconnecter",
      danger: true,
      onPress: () => {
        close();
        void useAuthStore.getState().signOut();
      },
    },
  ];

  return (
    <View className="flex-row items-center gap-3">
      <IconCircle icon="notifications-outline" label="Notifications" size={44} badge={unread} onPress={() => router.push("/notifications")} />
      <View ref={ref} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menu du compte"
          onPress={open}
          className="h-[44px] w-[44px] items-center justify-center rounded-full bg-brand"
        >
          <Text className="font-jakarta text-[17px] font-bold text-ink">{(org?.name?.[0] ?? email?.[0] ?? "P").toUpperCase()}</Text>
        </Pressable>
      </View>

      <Popover anchor={anchor} onClose={close} width={290}>
        <View className="border-b border-line px-5 py-4">
          <Text numberOfLines={1} className="font-jakarta text-[17px] font-semibold text-ink">{org?.name ?? "Postbiz"}</Text>
          <Text numberOfLines={1} className="font-jakarta text-[13px] text-ink-soft">{email}</Text>
        </View>
        <View className="py-1">
          {rows.map((r) => (
            <Pressable key={r.label} onPress={r.onPress} className="flex-row items-center gap-4 px-5 py-4">
              <Ionicons name={r.icon} size={22} color={r.danger ? "#D92D20" : "#141414"} />
              <Text className={`font-jakarta text-[16px] ${r.danger ? "text-text-critical" : "text-ink"}`}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      </Popover>
    </View>
  );
}
