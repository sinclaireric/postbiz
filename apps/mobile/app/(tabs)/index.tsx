import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { addDays, format, isSameDay, isToday, isTomorrow, parseISO, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ChannelPicker } from "@/components/home/channel-picker";
import { haptic } from "@/lib/haptics";
import { DateJumpSheet } from "@/components/home/date-jump-sheet";
import { HeaderActions } from "@/components/home/header-actions";
import { PostCard } from "@/components/home/post-card";
import { WeekStrip } from "@/components/home/week-strip";
import { ConfirmSheet, EmptyState, IconCircle, Pill, SegmentedPill, Sheet } from "@/components/ui/kit";
import { TAB_BAR_HEIGHT } from "@/components/ui/main-tab-navbar";
import { showToast } from "@/components/ui/toast";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";
import type { ScheduledPost } from "@/types";
import { htmlToPlain, capFirst } from "@/utils/text";

type StatusFilter = "queue" | "draft" | "sent" | "error";

const inState = (p: ScheduledPost, f: StatusFilter) => {
  const s = p.dbState ?? "queued";
  if (f === "queue") return s === "queued" || s === "publishing";
  if (f === "draft") return s === "draft";
  if (f === "sent") return s === "published";
  return s === "error" || s === "unknown";
};

const dayTitle = (d: Date) => {
  const base = format(d, "EEEE d MMMM", { locale: fr });
  if (isToday(d)) return `Aujourd’hui, ${format(d, "d MMM", { locale: fr })}`;
  if (isTomorrow(d)) return `Demain, ${format(d, "d MMM", { locale: fr })}`;
  return base;
};

export default function PublishScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const allPosts = usePostsStore((s) => s.posts);
  const loaded = usePostsStore((s) => s.loaded);
  const channels = useChannelsStore((s) => s.channels);
  const canWrite = useOrgStore((s) => s.canWrite);
  const orgId = useOrgStore((s) => s.current?.id);
  const navigateToDate = usePostsStore((s) => s.navigateToDate);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("queue");
  const [calendarMode, setCalendarMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [jumpOpen, setJumpOpen] = useState(false);
  const [menuPost, setMenuPost] = useState<ScheduledPost | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledPost | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Après une création, la liste se place sur la date de la publication.
  useEffect(() => {
    if (!navigateToDate) return;
    setSelectedDate(startOfDay(new Date(navigateToDate)));
    usePostsStore.getState().setNavigateToDate(null);
  }, [navigateToDate]);

  const activeChannel = channelId && channels.some((c) => c.id === channelId) ? channelId : null;
  const posts = useMemo(() => (activeChannel ? allPosts.filter((p) => p.channelId === activeChannel) : allPosts), [allPosts, activeChannel]);

  const hasPosts = useCallback((d: Date) => posts.some((p) => isSameDay(parseISO(p.scheduledAt), d)), [posts]);

  const counts = useMemo(
    () => ({
      queue: posts.filter((p) => inState(p, "queue")).length,
      error: posts.filter((p) => inState(p, "error")).length,
    }),
    [posts],
  );

  const sections = useMemo(() => {
    const list = calendarMode
      ? posts.filter((p) => isSameDay(parseISO(p.scheduledAt), selectedDate))
      : posts.filter((p) => inState(p, status));
    // À venir : du plus proche au plus lointain ; envoyées et échecs : du plus récent au plus ancien.
    const asc = calendarMode || status === "queue" || status === "draft";
    const sorted = [...list].sort((a, b) => (asc ? 1 : -1) * (parseISO(a.scheduledAt).getTime() - parseISO(b.scheduledAt).getTime()));
    const groups: { key: string; date: Date; data: ScheduledPost[] }[] = [];
    for (const p of sorted) {
      const d = startOfDay(parseISO(p.scheduledAt));
      const key = d.toISOString();
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.data.push(p);
      else groups.push({ key, date: d, data: [p] });
    }
    // À venir : on ne montre que ce qui n'est pas passé ou ce qui est en cours d'envoi.
    return groups.map((g) => ({ title: dayTitle(g.date), data: g.data, key: g.key }));
  }, [posts, status, calendarMode, selectedDate]);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setRefreshing(true);
    await usePostsStore.getState().load(orgId);
    setRefreshing(false);
  }, [orgId]);

  const compose = (date?: Date) =>
    router.push({ pathname: "/create-post", params: date ? { dateTime: date.toISOString() } : {} } as never);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const result = await usePostsStore.getState().deletePost(target.id);
    showToast(result.ok ? "Publication supprimée" : result.error, result.ok ? "success" : "error");
  };

  const duplicate = async (post: ScheduledPost) => {
    const result = await usePostsStore.getState().duplicatePost(post.id);
    if (!result.ok || !result.id) {
      showToast(result.ok ? "Copie impossible" : result.error, "error");
      return;
    }
    showToast("Brouillon créé", "success");
    setStatus("draft");
    setCalendarMode(false);
  };

  const menuEditable = menuPost && canWrite && ["draft", "queued", "error", "unknown"].includes(menuPost.dbState ?? "queued");

  const monthLabel = format(selectedDate, "MMMM", { locale: fr });
  const bottomSpace = TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) + (calendarMode ? 0 : 64);

  const emptyFor = () => {
    if (calendarMode) {
      return {
        icon: "calendar-clear-outline" as const,
        title: "Rien de prévu ce jour-là",
        text: format(selectedDate, "EEEE d MMMM", { locale: fr }),
        primary: canWrite ? { label: "Rédiger une publication", onPress: () => compose(addDays(selectedDate, 0)) } : undefined,
      };
    }
    switch (status) {
      case "queue":
        return { icon: "calendar-outline" as const, title: "Aucune publication planifiée", text: "Planifiez des publications, elles apparaîtront ici.", primary: canWrite ? { label: "Rédiger une publication", onPress: () => compose() } : undefined };
      case "draft":
        return { icon: "create-outline" as const, title: "Aucun brouillon", text: "Vos brouillons apparaîtront ici dès que vous en aurez enregistré.", primary: canWrite ? { label: "Créer un brouillon", onPress: () => compose() } : undefined };
      case "sent":
        return { icon: "paper-plane-outline" as const, title: "Rien d’envoyé pour l’instant", text: "Les publications envoyées sur vos réseaux seront listées ici." };
      default:
        return { icon: "checkmark-circle-outline" as const, title: "Aucun échec", text: "Tout part comme prévu. Les publications en erreur s’afficheront ici." };
    }
  };
  const empty = emptyFor();

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />

      <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
        <Text className="font-jakarta text-[27px] font-semibold text-ink">Publier</Text>
        <HeaderActions />
      </View>

      <View className="flex-row items-center justify-between gap-3 px-4 pb-3">
        <ChannelPicker channels={channels} value={activeChannel} onChange={setChannelId} compact={calendarMode} />
        {calendarMode ? (
          <Pill onPress={() => setJumpOpen(true)}>
            <Text className="font-jakarta text-[14.5px] font-medium capitalize text-ink">{monthLabel}</Text>
            <Ionicons name="swap-vertical" size={16} color="#141414" />
          </Pill>
        ) : null}
        <IconCircle icon={calendarMode ? "calendar" : "calendar-outline"} label={calendarMode ? "Masquer la semaine" : "Afficher la semaine"} active={calendarMode} onPress={() => setCalendarMode((v) => !v)} size={46} />
      </View>

      {calendarMode ? (
        <View className="pb-3">
          <WeekStrip selectedDate={selectedDate} onSelect={(d) => setSelectedDate(startOfDay(d))} hasPosts={hasPosts} />
        </View>
      ) : null}

      <SectionList
        className="flex-1"
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomSpace }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#2F4A00" />}
        renderSectionHeader={({ section }) => (
          <Text className="pb-3 pt-4 font-jakarta text-[17px] font-semibold text-ink">{capFirst(section.title)}</Text>
        )}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.duration(380).delay(Math.min(index, 8) * 45)} style={{ paddingBottom: 12 }}>
            <PostCard post={item} onPress={() => router.push(`/post/${item.id}` as never)} onMenu={setMenuPost} />
          </Animated.View>
        )}
        ListEmptyComponent={
          loaded ? (
            <Animated.View entering={FadeIn.duration(350)}>
              <EmptyState {...empty} />
            </Animated.View>
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      />

      {calendarMode ? null : (
        <View pointerEvents="box-none" className="absolute left-3 right-3" style={{ bottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) - 8 }}>
          <SegmentedPill<StatusFilter>
            value={status}
            onChange={setStatus}
            items={[
              { id: "queue", label: "À venir" },
              { id: "draft", label: "Brouillons" },
              { id: "sent", label: "Envoyées" },
              { id: "error", label: "Échecs", count: counts.error },
            ]}
          />
        </View>
      )}

      <DateJumpSheet visible={jumpOpen} onClose={() => setJumpOpen(false)} selectedDate={selectedDate} onSelect={(d) => setSelectedDate(startOfDay(d))} hasPosts={hasPosts} />

      <Sheet visible={menuPost !== null} onClose={() => setMenuPost(null)} title="Publication">
        {menuPost ? (
          <View className="overflow-hidden rounded-[22px] bg-card">
            {(
              [
                { icon: "eye-outline", label: "Voir la publication", run: () => router.push(`/post/${menuPost.id}` as never) },
                {
                  icon: "copy-outline",
                  label: "Copier le texte",
                  run: async () => {
                    await Clipboard.setStringAsync(htmlToPlain(menuPost.content));
                    showToast("Texte copié", "success");
                  },
                },
                ...(canWrite ? [{ icon: "documents-outline", label: "Dupliquer en brouillon", run: () => duplicate(menuPost) }] : []),
                ...(menuPost.releaseUrl ? [{ icon: "open-outline", label: "Ouvrir sur le réseau", run: () => void WebBrowser.openBrowserAsync(menuPost.releaseUrl as string) }] : []),
                ...(menuEditable ? [{ icon: "trash-outline", label: "Supprimer", danger: true, run: () => setDeleteTarget(menuPost) }] : []),
              ] as { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; run: () => void | Promise<void> }[]
            ).map((row, i) => (
              <Pressable
                key={row.label}
                onPress={() => {
                  haptic.tap();
                  setMenuPost(null);
                  setTimeout(() => void row.run(), 250);
                }}
                className={`flex-row items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-line" : ""}`}
              >
                <Ionicons name={row.icon} size={22} color={row.danger ? "#D92D20" : "#141414"} />
                <Text className={`font-jakarta text-[15px] ${row.danger ? "text-text-critical" : "text-ink"}`}>{row.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={deleteTarget !== null}
        title="Supprimer la publication ?"
        message="Elle sera retirée de la liste. Cette action ne supprime rien chez le réseau."
        confirmLabel="Oui, supprimer"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </SafeAreaView>
  );
}
