import { Ionicons } from "@expo/vector-icons";
import { capFirst } from "@/utils/text";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, PageHeader } from "@/components/ui/kit";
import { useNotificationsStore } from "@/store/notifications-store";
import type { NotificationItem } from "@/types";

const dayTitle = (iso: string) => {
  const d = parseISO(iso);
  if (isToday(d)) return "Aujourd’hui";
  if (isYesterday(d)) return "Hier";
  return format(d, "EEEE d MMMM", { locale: fr });
};

const iconFor = (type: string): keyof typeof Ionicons.glyphMap => {
  if (type.includes("fail") || type.includes("error")) return "alert-circle";
  if (type.includes("message") || type.includes("conversation") || type.includes("comment")) return "chatbubble-ellipses";
  return "checkmark-circle";
};

export default function NotificationsScreen() {
  const router = useRouter();
  const items = useNotificationsStore((s) => s.items);
  const hasUnread = items.some((n) => n.unread);

  const sections = useMemo(() => {
    const groups: { title: string; data: NotificationItem[] }[] = [];
    for (const item of items) {
      const title = dayTitle(item.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(item);
      else groups.push({ title, data: [item] });
    }
    return groups;
  }, [items]);

  const open = (item: NotificationItem) => {
    void useNotificationsStore.getState().markAsRead(item.id);
    const conversationId = item.data.conversation_id;
    if (typeof conversationId === "string" && conversationId) router.push(`/conversation/${conversationId}` as never);
    else if (typeof item.data.post_id === "string") router.push(`/post/${item.data.post_id}` as never);
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />
      <PageHeader
        title="Notifications"
        onBack={() => router.back()}
        right={
          hasUnread ? (
            <Pressable hitSlop={8} onPress={() => void useNotificationsStore.getState().markAllAsRead()}>
              <Text className="font-jakarta text-[14px] font-semibold text-brand-ink">Tout lire</Text>
            </Pressable>
          ) : undefined
        }
      />
      <SectionList
        className="flex-1"
        sections={sections}
        keyExtractor={(n) => n.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListEmptyComponent={<EmptyState icon="notifications-outline" title="Aucune notification" text="Les publications envoyées, les échecs et les nouveaux messages apparaîtront ici." />}
        renderSectionHeader={({ section }) => <Text className="pb-2 pt-4 font-jakarta text-[18px] font-semibold text-ink">{capFirst(section.title)}</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)} className="mb-2 flex-row items-start gap-3 rounded-[20px] border border-line bg-card p-4">
            <View className={`h-10 w-10 items-center justify-center rounded-full ${item.unread ? "bg-brand" : "bg-chip-bg"}`}>
              <Ionicons name={iconFor(item.type)} size={20} color="#141414" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className={`font-jakarta text-[15px] text-ink ${item.unread ? "font-bold" : "font-semibold"}`}>{item.title}</Text>
              {item.body ? <Text numberOfLines={3} className="mt-[2px] font-jakarta text-[14px] leading-[20px] text-ink-soft">{item.body}</Text> : null}
              <Text className="mt-1 font-jakarta text-[12px] text-ink-muted">{format(parseISO(item.createdAt), "HH:mm")}</Text>
            </View>
            {item.unread ? <View className="mt-2 h-[9px] w-[9px] rounded-full bg-brand-ink" /> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
