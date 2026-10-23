import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { memo, useCallback, useMemo, useState } from "react";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ChannelPicker } from "@/components/home/channel-picker";
import { haptic } from "@/lib/haptics";
import { HeaderActions } from "@/components/home/header-actions";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { EmptyState, IconPill, OutlineButton, SegmentedPill, Sheet } from "@/components/ui/kit";
import { TAB_BAR_HEIGHT } from "@/components/ui/main-tab-navbar";
import { showToast } from "@/components/ui/toast";
import { filterConversations, formatRelative, replyWindow, sortConversations } from "@/lib/inbox/logic";
import type { ConversationSummary } from "@/lib/inbox/types";
import { useNow } from "@/lib/use-now";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useOrgStore } from "@/store/org-store";

type Kind = "comment_thread" | "dm";
type View_ = "active" | "unread" | "closed";

const Row = memo(function Row({ c, now, onPress, avatar }: { c: ConversationSummary; now: Date; onPress: () => void; avatar?: string }) {
  const window = replyWindow(c.replyWindowExpiresAt, now);
  const unread = c.unreadCount > 0;
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 rounded-[22px] border border-line bg-card p-4">
      <ChannelAvatar avatar={avatar} network={c.networkId} name={c.contactName} size={46} />
      <View className="min-w-0 flex-1 gap-[2px]">
        <View className="flex-row items-center justify-between gap-2">
          <Text numberOfLines={1} className={`flex-1 font-jakarta text-[14.5px] text-ink ${unread ? "font-bold" : "font-semibold"}`}>{c.contactName}</Text>
          <Text className="font-jakarta text-[11px] text-ink-muted">{formatRelative(c.lastMessageAt, now)}</Text>
        </View>
        <Text numberOfLines={2} className={`font-jakarta text-[12.5px] leading-[18px] ${unread ? "text-ink" : "text-ink-soft"}`}>{c.lastMessagePreview || "—"}</Text>
        <View className="flex-row items-center gap-2 pt-[2px]">
          <Text numberOfLines={1} className="shrink font-jakarta text-[11px] text-ink-muted">{c.accountName}</Text>
          {c.status !== "closed" && window.state === "urgent" ? <Text className="font-jakarta text-[11px] font-semibold text-[#B45309]">{window.label}</Text> : null}
          {c.status !== "closed" && window.state === "expired" ? <Text className="font-jakarta text-[11px] font-semibold text-text-critical">Fenêtre expirée</Text> : null}
        </View>
      </View>
      {unread ? (
        <View className="min-w-[22px] items-center rounded-full bg-brand px-[7px] py-[2px]">
          <Text className="font-jakarta text-[11px] font-bold text-ink">{c.unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

export default function CommunityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const conversations = useInboxStore((s) => s.conversations);
  const loaded = useInboxStore((s) => s.loaded);
  const error = useInboxStore((s) => s.error);
  const channels = useChannelsStore((s) => s.channels);
  const orgId = useOrgStore((s) => s.current?.id);
  const canWrite = useOrgStore((s) => s.canWrite);

  const [kind, setKind] = useState<Kind>("comment_thread");
  const [view, setView] = useState<View_>("active");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const activeChannel = channelId && channels.some((c) => c.id === channelId) ? channelId : null;
  const channelName = activeChannel ? channels.find((c) => c.id === activeChannel)?.name : null;

  // Les conversations ne portent que le nom du compte (pas son id) : le filtre par canal compare nom et réseau.
  const inChannel = useCallback(
    (c: ConversationSummary) => {
      if (!activeChannel) return true;
      const ch = channels.find((x) => x.id === activeChannel);
      return !!ch && ch.network === c.networkId && ch.name === c.accountName;
    },
    [activeChannel, channels],
  );

  const ofKind = useMemo(() => conversations.filter((c) => c.kind === kind && inChannel(c)), [conversations, kind, inChannel]);
  const unreadTotal = useMemo(() => conversations.filter((c) => c.status !== "closed").reduce((n, c) => n + c.unreadCount, 0), [conversations]);
  const unreadByKind = (k: Kind) => conversations.filter((c) => c.kind === k && c.status !== "closed" && inChannel(c)).reduce((n, c) => n + c.unreadCount, 0);

  const visible = useMemo(
    () => sortConversations(filterConversations(ofKind, { status: view, q: query }), now),
    [ofKind, view, query, now],
  );

  const avatarFor = (c: ConversationSummary) => channels.find((x) => x.network === c.networkId && x.name === c.accountName)?.avatar;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setRefreshing(true);
    await useInboxStore.getState().load(orgId);
    setRefreshing(false);
  }, [orgId]);

  const resolve = async (olderThanDays: number | null) => {
    setResolveOpen(false);
    const limit = olderThanDays === null ? null : Date.now() - olderThanDays * 86_400_000;
    const ids = ofKind.filter((c) => c.status !== "closed" && (limit === null || new Date(c.lastMessageAt).getTime() < limit)).map((c) => c.id);
    if (ids.length === 0) {
      showToast("Rien à résoudre.", "info");
      return;
    }
    const result = await useInboxStore.getState().closeMany(ids);
    showToast(result.ok ? `${ids.length} conversation${ids.length > 1 ? "s" : ""} résolue${ids.length > 1 ? "s" : ""}` : result.error, result.ok ? "success" : "error");
  };

  const emptyText = error ?? (query ? "Aucun résultat" : view === "closed" ? "Aucune conversation résolue" : kind === "comment_thread" ? "Aucun commentaire pour l’instant" : "Aucun message pour l’instant");

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />

      <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
        <View className="flex-row items-center gap-3">
          <Text className="font-jakarta text-[27px] font-semibold text-ink">Messages</Text>
          {unreadTotal > 0 ? (
            <View className="h-[34px] min-w-[34px] items-center justify-center rounded-full bg-brand px-2">
              <Text className="font-jakarta text-[13.5px] font-bold text-ink">{unreadTotal > 99 ? "99+" : unreadTotal}</Text>
            </View>
          ) : null}
        </View>
        <HeaderActions />
      </View>

      <View className="flex-row items-center justify-between gap-3 px-4 pb-3">
        <ChannelPicker channels={channels} value={activeChannel} onChange={setChannelId} />
        <IconPill
          items={[
            { icon: "search", label: "Rechercher", active: searching, onPress: () => { setSearching((v) => !v); if (searching) setQuery(""); } },
            { icon: "funnel-outline", label: "Filtrer", active: view !== "active", onPress: () => setFilterOpen(true) },
            ...(canWrite ? [{ icon: "checkmark-done" as const, label: "Tout résoudre", onPress: () => setResolveOpen(true) }] : []),
          ]}
        />
      </View>

      {searching ? (
        <View className="mx-4 mb-3 h-[48px] flex-row items-center gap-2 rounded-full bg-card px-4">
          <Ionicons name="search" size={18} color="#9A9890" />
          <TextInput className="flex-1 font-jakarta text-[14.5px] text-ink" placeholder="Contact ou message" placeholderTextColor="#9A9890" value={query} onChangeText={setQuery} autoFocus autoCorrect={false} />
        </View>
      ) : null}

      {!loaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#2F4A00" />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={visible}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) + 72 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#2F4A00" />}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(350).delay(Math.min(index, 8) * 40)}>
              <Row c={item} now={now} avatar={avatarFor(item)} onPress={() => router.push(`/conversation/${item.id}` as never)} />
            </Animated.View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={kind === "comment_thread" ? "chatbubble-outline" : "mail-outline"}
              title={emptyText}
              text={error || query ? undefined : "Nous vous prévenons dès qu’un nouveau message arrive sur vos canaux connectés."}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <View pointerEvents="box-none" className="absolute left-3 right-3" style={{ bottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) - 8 }}>
        <SegmentedPill<Kind>
          value={kind}
          onChange={setKind}
          items={[
            { id: "comment_thread", label: "Commentaires", count: unreadByKind("comment_thread") },
            { id: "dm", label: "Messages privés", count: unreadByKind("dm") },
          ]}
        />
      </View>

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Filtrer">
        <View className="overflow-hidden rounded-[22px] bg-card">
          {(
            [
              ["active", "En cours", "Ouvertes, en attente et reportées"],
              ["unread", "Non lues", "Seulement celles qui attendent une réponse"],
              ["closed", "Résolues", "Conversations fermées"],
            ] as [View_, string, string][]
          ).map(([id, label, hint], i) => (
            <Pressable key={id} onPress={() => { haptic.select(); setView(id); setFilterOpen(false); }} className={`flex-row items-center gap-3 px-5 py-4 ${i > 0 ? "border-t border-line" : ""}`}>
              <View className="flex-1">
                <Text className="font-jakarta text-[15px] text-ink">{label}</Text>
                <Text className="font-jakarta text-[12px] text-ink-soft">{hint}</Text>
              </View>
              {view === id ? <Ionicons name="checkmark" size={22} color="#2F4A00" /> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={resolveOpen} onClose={() => setResolveOpen(false)} title="Résoudre">
        <View className="gap-3 pb-2">
          <Text className="font-jakarta text-[13.5px] leading-[19.5px] text-ink-soft">
            Choisissez quelles conversations {kind === "comment_thread" ? "de commentaires" : "privées"}
            {channelName ? ` de ${channelName}` : ""} marquer comme résolues.
          </Text>
          <OutlineButton label="Tout résoudre" onPress={() => resolve(null)} />
          <OutlineButton label="Plus de 7 jours" onPress={() => resolve(7)} />
          <OutlineButton label="Plus d’un mois" onPress={() => resolve(30)} />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
