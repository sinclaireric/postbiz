import { Ionicons } from "@expo/vector-icons";
import { addDays, format, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ChannelPicker } from "@/components/home/channel-picker";
import { HeaderActions } from "@/components/home/header-actions";
import { PostCard } from "@/components/home/post-card";
import { LineChart, type ChartPoint } from "@/components/ui/line-chart";
import { Pill } from "@/components/ui/kit";
import { MainTabNavbar, TAB_BAR_HEIGHT } from "@/components/ui/main-tab-navbar";
import { Popover, useAnchor } from "@/components/ui/popover";
import { DEMO } from "@/lib/demo";
import { supabase } from "@/lib/supabase";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";

// Chiffres calculés à partir des données de Postbiz (publications, messages). Les métriques d'audience des réseaux
// (abonnés, impressions, réactions) ne sont pas encore collectées : aucune table n'existe pour elles.

const PERIODS = [
  { days: 7, label: "7 derniers jours" },
  { days: 30, label: "30 derniers jours" },
  { days: 90, label: "90 derniers jours" },
] as const;

type Metric = "published" | "received" | "replies";
const METRICS: { id: Metric; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "published", label: "Publications", icon: "paper-plane-outline" },
  { id: "received", label: "Messages reçus", icon: "mail-unread-outline" },
  { id: "replies", label: "Réponses", icon: "return-up-back-outline" },
];

type Msg = { created_at: string; direction: "in" | "out"; delivery_status: string };

function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  const diff = now - before;
  const pct = before === 0 ? null : Math.round((diff / before) * 100);
  const up = diff >= 0;
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={diff === 0 ? "remove" : up ? "trending-up" : "trending-down"} size={15} color={diff === 0 ? "#9A9890" : up ? "#0A7A3B" : "#B42318"} />
      <Text className="font-jakarta text-[13px] font-semibold" style={{ color: diff === 0 ? "#9A9890" : up ? "#0A7A3B" : "#B42318" }}>
        {diff === 0 ? "=" : `${up ? "+" : ""}${pct === null ? diff : `${pct} %`}`}
      </Text>
      <Text className="font-jakarta text-[12px] text-ink-muted">vs période préc.</Text>
    </View>
  );
}

function Kpi({ label, value, before, tint }: { label: string; value: number; before?: number | null; tint?: string }) {
  return (
    <View className="min-w-[46%] flex-1 gap-1 rounded-[22px] border border-line bg-card p-4">
      <Text className="font-jakarta text-[15px] font-semibold text-ink">{label}</Text>
      <Text className="font-jakarta text-[34px] font-semibold" style={{ color: tint ?? "#141414" }}>{value}</Text>
      {before !== undefined ? <Delta now={value} before={before} /> : <View className="h-[19px]" />}
    </View>
  );
}

export default function InsightsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const orgId = useOrgStore((s) => s.current?.id);
  const channels = useChannelsStore((s) => s.channels);
  const allPosts = usePostsStore((s) => s.posts);
  const conversations = useInboxStore((s) => s.conversations);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<Metric>("published");
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const periodMenu = useAnchor();

  const activeChannel = channelId && channels.some((c) => c.id === channelId) ? channelId : null;
  const channel = channels.find((c) => c.id === activeChannel);

  const loadMessages = useCallback(async () => {
    if (!orgId) return;
    if (DEMO) {
      setMessages([]);
      return;
    }
    const since = new Date(Date.now() - 2 * days * 86_400_000).toISOString();
    let q = supabase
      .from("messages")
      .select("created_at, direction, delivery_status, conversations!inner(integration_id)")
      .eq("org_id", orgId)
      .gte("created_at", since)
      .limit(5000);
    if (activeChannel) q = q.eq("conversations.integration_id", activeChannel);
    const { data } = await q;
    setMessages((data ?? []) as unknown as Msg[]);
  }, [orgId, days, activeChannel]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const stats = useMemo(() => {
    const now = Date.now();
    const span = days * 86_400_000;
    const posts = activeChannel ? allPosts.filter((p) => p.channelId === activeChannel) : allPosts;
    const inRange = (iso: string, from: number, to: number) => {
      const t = new Date(iso).getTime();
      return t >= from && t < to;
    };
    const published = (from: number, to: number) => posts.filter((p) => p.dbState === "published" && inRange(p.scheduledAt, from, to));
    const cur = published(now - span, now);
    // Les publications chargées couvrent 90 jours : la période précédente n'est comparable que si elle y tient.
    const hasPrev = days * 2 <= 90;
    const prevPublished = hasPrev ? published(now - 2 * span, now - span).length : null;

    const msgs = messages ?? [];
    const received = (from: number, to: number) => msgs.filter((m) => m.direction === "in" && inRange(m.created_at, from, to));
    const replies = (from: number, to: number) => msgs.filter((m) => m.direction === "out" && m.delivery_status === "sent" && inRange(m.created_at, from, to));

    const upcoming = posts.filter((p) => (p.dbState === "queued" || p.dbState === "publishing") && new Date(p.scheduledAt).getTime() >= now);
    const next7 = upcoming.filter((p) => new Date(p.scheduledAt).getTime() < now + 7 * 86_400_000);
    const failed = posts.filter((p) => (p.dbState === "error" || p.dbState === "unknown") && new Date(p.scheduledAt).getTime() >= now - span);

    const bucketCount = days === 90 ? 13 : days;
    const bucketMs = days === 90 ? 7 * 86_400_000 : 86_400_000;
    const start = startOfDay(new Date(now - (bucketCount - 1) * bucketMs)).getTime();
    const series = (iso: string[]): ChartPoint[] =>
      Array.from({ length: bucketCount }, (_, i) => {
        const from = start + i * bucketMs;
        const value = iso.filter((t) => inRange(t, from, from + bucketMs)).length;
        return { label: format(new Date(from), days === 90 ? "d MMM" : "d MMM", { locale: fr }), value };
      });

    return {
      publishedNow: cur.length,
      publishedPrev: prevPublished,
      receivedNow: received(now - span, now).length,
      receivedPrev: received(now - 2 * span, now - span).length,
      repliesNow: replies(now - span, now).length,
      repliesPrev: replies(now - 2 * span, now - span).length,
      upcoming: upcoming.length,
      next7: next7.length,
      drafts: posts.filter((p) => p.dbState === "draft").length,
      failed: failed.length,
      recent: [...cur].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()).slice(0, 3),
      chart: {
        published: series(cur.map((p) => p.scheduledAt)),
        received: series(received(start, now).map((m) => m.created_at)),
        replies: series(replies(start, now).map((m) => m.created_at)),
      },
    };
  }, [allPosts, messages, days, activeChannel]);

  const unread = useMemo(() => conversations.filter((c) => c.status !== "closed").reduce((n, c) => n + c.unreadCount, 0), [conversations]);

  const insight = useMemo(() => {
    if (stats.failed > 0) return { title: "Publications à vérifier", text: `${stats.failed} publication${stats.failed > 1 ? "s ont" : " a"} échoué. Vérifiez-les avant de reprogrammer.`, cta: "Ouvrir Publier", go: () => router.replace("/(tabs)") };
    if (unread > 0) return { title: "Des clients attendent une réponse", text: `${unread} message${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""}. Répondre vite améliore votre image.`, cta: "Répondre", go: () => router.replace("/(tabs)/inbox") };
    if (stats.next7 === 0) return { title: "Planifiez votre semaine", text: "Aucune publication n’est prévue ces 7 prochains jours. L’agent peut vous proposer des textes en quelques secondes.", cta: "Créer avec l’agent", go: () => router.replace("/(tabs)/agent") };
    return { title: "Tout est en ordre", text: `${stats.next7} publication${stats.next7 > 1 ? "s" : ""} prévue${stats.next7 > 1 ? "s" : ""} ces 7 prochains jours, aucun échec, aucun message en attente.`, cta: "Rédiger une publication", go: () => router.push("/create-post") };
  }, [stats, unread, router]);

  const period = PERIODS.find((p) => p.days === days)!;
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadMessages(), orgId ? usePostsStore.getState().load(orgId) : Promise.resolve()]);
    setRefreshing(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />

      <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
        <Text numberOfLines={1} className="mr-3 flex-1 font-jakarta text-[32px] font-semibold text-ink">{channel ? channel.name : "Insights"}</Text>
        <HeaderActions />
      </View>

      <View className="flex-row items-center gap-3 px-4 pb-3">
        <ChannelPicker channels={channels} value={activeChannel} onChange={setChannelId} compact={false} />
        <View ref={periodMenu.ref} collapsable={false}>
          <Pill onPress={periodMenu.open}>
            <Ionicons name="calendar-outline" size={18} color="#141414" />
            <Text className="font-jakarta text-[15px] font-medium text-ink">{days} j</Text>
            <Ionicons name="chevron-down" size={16} color="#141414" />
          </Pill>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, gap: 18, paddingBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) + 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#2F4A00" />}
      >
        <Text className="font-jakarta text-[13px] text-ink-soft">{period.label}</Text>

        <View className="gap-3">
          <Text className="font-jakarta text-[22px] font-semibold text-ink">Points clés</Text>
          <View className="gap-3 rounded-[22px] border border-line bg-card p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="sparkles" size={18} color="#2F4A00" />
              <Text className="flex-1 font-jakarta text-[17px] font-semibold text-ink">{insight.title}</Text>
            </View>
            <Text className="font-jakarta text-[15px] leading-[22px] text-ink-soft">{insight.text}</Text>
            <Pressable onPress={insight.go} className="h-[44px] items-center justify-center self-start rounded-full bg-brand px-5">
              <Text className="font-jakarta text-[15px] font-semibold text-ink">{insight.cta}</Text>
            </Pressable>
          </View>
        </View>

        <View className="gap-3">
          <Text className="font-jakarta text-[22px] font-semibold text-ink">Résumé</Text>
          <View className="flex-row flex-wrap gap-3">
            <Kpi label="Publications" value={stats.publishedNow} before={stats.publishedPrev} />
            <Kpi label="À venir" value={stats.upcoming} />
            <Kpi label="Messages reçus" value={stats.receivedNow} before={messages === null ? undefined : stats.receivedPrev} />
            <Kpi label="Réponses envoyées" value={stats.repliesNow} before={messages === null ? undefined : stats.repliesPrev} />
            <Kpi label="Brouillons" value={stats.drafts} />
            <Kpi label="Échecs" value={stats.failed} tint={stats.failed > 0 ? "#B42318" : undefined} />
          </View>
        </View>

        <View className="gap-3">
          <Text className="font-jakarta text-[22px] font-semibold text-ink">Publications récentes</Text>
          {stats.recent.length === 0 ? (
            <Text className="font-jakarta text-[15px] text-ink-soft">Aucune publication envoyée sur cette période.</Text>
          ) : (
            stats.recent.map((p) => <PostCard key={p.id} post={p} onPress={() => router.push(`/post/${p.id}` as never)} onMenu={() => router.push(`/post/${p.id}` as never)} />)
          )}
        </View>

        <View className="gap-3">
          <View>
            <Text className="font-jakarta text-[22px] font-semibold text-ink">Métriques</Text>
            <Text className="font-jakarta text-[13px] text-ink-soft">
              {format(addDays(new Date(), -(days - 1)), "d MMM", { locale: fr })} – {format(new Date(), "d MMM", { locale: fr })}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {METRICS.map((m) => (
              <Pressable key={m.id} onPress={() => setMetric(m.id)} className={`h-[44px] flex-row items-center gap-2 rounded-full border px-4 ${metric === m.id ? "border-brand bg-brand" : "border-line bg-card"}`}>
                <Ionicons name={m.icon} size={18} color="#141414" />
                <Text className="font-jakarta text-[15px] font-medium text-ink">{m.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View className="rounded-[22px] border border-line bg-card p-4">
            {messages === null && metric !== "published" ? <ActivityIndicator color="#2F4A00" /> : <LineChart points={stats.chart[metric]} />}
          </View>
        </View>

        <Text className="font-jakarta text-[12px] leading-[18px] text-ink-muted">
          Ces chiffres viennent de Postbiz. Les statistiques d’audience des réseaux (abonnés, impressions, réactions) arriveront plus tard.
        </Text>
      </ScrollView>

      <MainTabNavbar activeTab="insights" />

      <Popover anchor={periodMenu.anchor} onClose={periodMenu.close} width={230}>
        {PERIODS.map((p, i) => (
          <Pressable key={p.days} onPress={() => { setDays(p.days); periodMenu.close(); }} className={`flex-row items-center justify-between px-5 py-4 ${i > 0 ? "border-t border-line" : ""}`}>
            <Text className="font-jakarta text-[16px] text-ink">{p.label}</Text>
            {days === p.days ? <Ionicons name="checkmark" size={20} color="#2F4A00" /> : null}
          </Pressable>
        ))}
      </Popover>
    </SafeAreaView>
  );
}
