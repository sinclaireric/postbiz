import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MainTabNavbar } from "@/components/ui/main-tab-navbar";
import { NotificationBellButton } from "@/components/ui/notification-bell-button";
import { NETWORK_CONFIG } from "@/constants/networks";
import { filterConversations, formatRelative, replyWindow, sortConversations, type InboxFilters } from "@/lib/inbox/logic";
import type { ConversationSummary } from "@/lib/inbox/types";
import { useNow } from "@/lib/use-now";
import { useInboxStore } from "@/store/inbox-store";
import { useOrgStore } from "@/store/org-store";

type StatusFilter = NonNullable<InboxFilters["status"]>;

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "active", label: "En cours" },
  { id: "unread", label: "Non lues" },
  { id: "closed", label: "Fermées" },
];

const ConversationRow = memo(function ConversationRow({
  conversation,
  now,
  onPress,
}: {
  conversation: ConversationSummary;
  now: Date;
  onPress: () => void;
}) {
  const network = NETWORK_CONFIG[conversation.networkId];
  const window = replyWindow(conversation.replyWindowExpiresAt, now);
  const unread = conversation.unreadCount > 0;

  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 rounded-[10px] bg-channel-active-bg p-3">
      <View className="h-10 w-10 items-center justify-center rounded-[8px]" style={{ backgroundColor: network.bg }}>
        <Ionicons name={network.icon} size={20} color="#FFFFFF" />
      </View>

      <View className="min-w-0 flex-1 gap-[2px]">
        <View className="flex-row items-center justify-between gap-2">
          <Text
            numberOfLines={1}
            className={`flex-1 font-jakarta text-[14px] text-text-primary ${unread ? "font-bold" : "font-semibold"}`}
          >
            {conversation.contactName}
          </Text>
          <Text className="font-jakarta text-[11px] text-text-secondary">{formatRelative(conversation.lastMessageAt, now)}</Text>
        </View>
        <Text numberOfLines={1} className={`font-jakarta text-[13px] ${unread ? "text-text-primary" : "text-text-secondary"}`}>
          {conversation.lastMessagePreview || "—"}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="font-jakarta text-[11px] text-text-secondary">
            {conversation.kind === "comment_thread" ? "Commentaire" : "Message"} · {conversation.accountName}
          </Text>
          {conversation.status !== "closed" && window.state === "urgent" ? (
            <Text className="font-jakarta text-[11px] font-semibold text-main-accent-pink">{window.label}</Text>
          ) : null}
          {conversation.status !== "closed" && window.state === "expired" ? (
            <Text className="font-jakarta text-[11px] font-semibold text-text-critical">Fenêtre expirée</Text>
          ) : null}
        </View>
      </View>

      {unread ? (
        <View className="min-w-[20px] items-center rounded-full bg-main-accent-pink px-[6px] py-[1px]">
          <Text className="font-jakarta text-[11px] font-bold text-main-bg">{conversation.unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

export default function InboxScreen() {
  const router = useRouter();
  const now = useNow();
  const conversations = useInboxStore((s) => s.conversations);
  const loaded = useInboxStore((s) => s.loaded);
  const error = useInboxStore((s) => s.error);
  const orgId = useOrgStore((s) => s.current?.id);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(
    () => sortConversations(filterConversations(conversations, { status, q: query }), now),
    [conversations, status, query, now],
  );

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setRefreshing(true);
    await useInboxStore.getState().load(orgId);
    setRefreshing(false);
  }, [orgId]);

  return (
    <SafeAreaView className="flex-1 bg-background-primary" edges={["top"]}>
      <StatusBar style="light" />

      <View className="h-[60px] flex-row items-center justify-between px-4">
        <Text className="font-jakarta text-h2 font-semibold text-text-primary">Boîte de réception</Text>
        <NotificationBellButton />
      </View>

      <View className="gap-3 px-4 pb-3">
        <View className="h-[44px] flex-row items-center gap-2 rounded-[10px] border border-input-stroke-default bg-input-bg px-3">
          <Ionicons name="search" size={16} className="text-icon-secondary" />
          <TextInput
            className="flex-1 p-0 font-jakarta text-body-1 text-text-primary"
            placeholder="Rechercher un contact ou un message"
            placeholderTextColor="#656464"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        <View className="flex-row gap-2">
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => setStatus(f.id)}
              className={`h-8 items-center justify-center rounded-full border px-4 ${
                status === f.id ? "border-tab-bg-active bg-tab-bg-active" : "border-tab-stroke-default bg-tab-bg-default"
              }`}
            >
              <Text
                className={`font-jakarta text-[13px] font-semibold ${status === f.id ? "text-tab-text-active" : "text-tab-text-default"}`}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {!loaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FC69FF" />
        </View>
      ) : (
        <FlatList
          className="flex-1 px-4"
          contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
          data={visible}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ConversationRow conversation={item} now={now} onPress={() => router.push(`/conversation/${item.id}` as never)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#FC69FF" />}
          ListEmptyComponent={
            <View className="items-center px-8 pt-16">
              <Text className="text-center font-jakarta text-h4 font-semibold text-text-primary">
                {error ?? (query ? "Aucun résultat" : conversations.length === 0 ? "Aucune conversation pour l’instant" : "Rien dans cette liste")}
              </Text>
              {!error && conversations.length === 0 ? (
                <Text className="mt-2 text-center font-jakarta text-body-1 text-text-secondary">
                  Les messages et commentaires de vos canaux connectés apparaîtront ici.
                </Text>
              ) : null}
            </View>
          }
        />
      )}

      <MainTabNavbar activeTab="inbox" />
    </SafeAreaView>
  );
}
