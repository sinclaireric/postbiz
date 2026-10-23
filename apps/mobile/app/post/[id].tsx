import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PostPreview } from "@/components/post-preview/post-preview";
import { DateTimeSheet } from "@/components/ui/datetime-sheet";
import { ConfirmSheet, EmptyState, OutlineButton, PageHeader, PrimaryButton } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { formatNetworkLabel } from "@/lib/networks";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";
import { htmlToPlain, capFirst } from "@/utils/text";

const EDITABLE_STATES = ["draft", "queued", "error", "unknown"];

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  draft: { label: "Brouillon", fg: "#5E5E5A", bg: "#EFEDE7" },
  queued: { label: "Programmée", fg: "#2F4A00", bg: "#EEF8C9" },
  publishing: { label: "Envoi en cours", fg: "#8A5A00", bg: "#FFF1CC" },
  published: { label: "Publiée", fg: "#0A7A3B", bg: "#DDF5E6" },
  error: { label: "Échec", fg: "#B42318", bg: "#FDE7E4" },
  unknown: { label: "Résultat incertain", fg: "#B42318", bg: "#FDE7E4" },
};

export default function PostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = usePostsStore((s) => s.posts.find((p) => p.id === id));
  const channel = useChannelsStore((s) => s.channels.find((c) => c.id === post?.channelId));
  const canWrite = useOrgStore((s) => s.canWrite);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dateVisible, setDateVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!post) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
        <StatusBar style="dark" />
        <PageHeader title="Aperçu" onBack={() => router.back()} />
        <EmptyState icon="document-outline" title="Cette publication n’existe plus" primary={{ label: "Retour", onPress: () => router.back() }} />
      </SafeAreaView>
    );
  }

  const dbState = post.dbState ?? "queued";
  const status = STATUS[dbState] ?? STATUS.queued;
  const editable = canWrite && EDITABLE_STATES.includes(dbState);
  const failed = dbState === "error" || dbState === "unknown";
  const thread = (post.composerPosts ?? [{ id: post.id, content: post.content, imageUris: [] }]).map((t) => htmlToPlain(t.content));

  const edit = () => router.push({ pathname: "/create-post", params: { postId: post.id, channelId: post.channelId, dateTime: post.scheduledAt } } as never);

  const duplicate = async () => {
    setBusy(true);
    const result = await usePostsStore.getState().duplicatePost(post.id);
    setBusy(false);
    if (!result.ok || !result.id) {
      showToast(result.ok ? "Copie impossible" : result.error, "error");
      return;
    }
    // La copie est un brouillon : on l'ouvre pour qu'elle soit relue avant d'être programmée.
    router.replace(`/post/${result.id}` as never);
    showToast("Brouillon créé", "success");
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    const result = await usePostsStore.getState().deletePost(post.id);
    setBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    showToast("Publication supprimée", "success");
    router.back();
  };

  const reschedule = async (date: Date) => {
    setDateVisible(false);
    const result = await usePostsStore.getState().reschedulePost(post.id, date.toISOString());
    showToast(result.ok ? "Date et heure modifiées" : result.error, result.ok ? "success" : "error");
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <PageHeader
        title="Aperçu"
        onBack={() => router.back()}
        right={
          <View className="rounded-full px-3 py-[6px]" style={{ backgroundColor: status.bg }}>
            <Text className="font-jakarta text-[12px] font-semibold" style={{ color: status.fg }}>{status.label}</Text>
          </View>
        }
      />

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ gap: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center gap-3 rounded-[22px] border border-line bg-card px-4 py-3">
          <Ionicons name="calendar-outline" size={22} color="#141414" />
          <View className="flex-1">
            <Text className="font-jakarta text-[12px] text-ink-soft">
              {formatNetworkLabel(post.network)} · {post.authorName}
            </Text>
            <Text className="font-jakarta text-[16px] font-semibold text-ink">{capFirst(format(parseISO(post.scheduledAt), "EEEE d MMMM 'à' HH:mm", { locale: fr }))}</Text>
          </View>
          {editable && !failed ? (
            <Pressable hitSlop={8} onPress={() => setDateVisible(true)}>
              <Text className="font-jakarta text-[14px] font-semibold text-brand-ink">Modifier</Text>
            </Pressable>
          ) : null}
        </View>

        {failed && post.errorMessage ? (
          <View className="rounded-[20px] bg-[#FDE7E4] px-4 py-3">
            <Text className="font-jakarta text-[14px] font-semibold text-text-critical">{dbState === "unknown" ? "La publication a peut-être été envoyée" : "La publication a échoué"}</Text>
            <Text className="mt-1 font-jakarta text-[14px] text-ink">{post.errorMessage}</Text>
            <Text className="mt-1 font-jakarta text-[12px] leading-[18px] text-ink-soft">
              Postbiz ne réessaie jamais seul, pour éviter un doublon chez le réseau. Vérifiez sur le réseau avant de reprogrammer.
            </Text>
          </View>
        ) : null}

        <PostPreview network={post.network} name={post.authorName || formatNetworkLabel(post.network)} username={channel?.username} avatar={post.authorAvatar || undefined} thread={thread} date={post.scheduledAt} />

        <Text className="font-jakarta text-[12px] text-ink-muted">Aperçu indicatif : l’affichage réel dépend du réseau et de l’appareil.</Text>
      </ScrollView>

      <View className="gap-2 px-4 pb-2 pt-2">
        {dbState === "published" && post.releaseUrl ? <PrimaryButton label="Voir sur le réseau" icon="open-outline" onPress={() => void WebBrowser.openBrowserAsync(post.releaseUrl as string)} /> : null}
        {dbState === "publishing" ? <Text className="text-center font-jakarta text-[13px] text-ink-soft">Envoi en cours : la publication ne peut plus être modifiée.</Text> : null}
        <View className="flex-row items-center gap-2">
          {editable ? (
            <View className="flex-1">
              <PrimaryButton label="Modifier" icon="create-outline" onPress={edit} disabled={busy} />
            </View>
          ) : null}
          {canWrite ? (
            <View className="flex-1">
              <OutlineButton label="Dupliquer" onPress={duplicate} disabled={busy} />
            </View>
          ) : null}
          {editable ? (
            <Pressable accessibilityLabel="Supprimer" disabled={busy} onPress={() => setConfirmDelete(true)} className="h-[56px] w-[56px] items-center justify-center rounded-full bg-[#FDE7E4]">
              <Ionicons name="trash-outline" size={22} color="#D92D20" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <DateTimeSheet visible={dateVisible} onClose={() => setDateVisible(false)} value={new Date(post.scheduledAt)} onSave={reschedule} />
      <ConfirmSheet visible={confirmDelete} title="Supprimer la publication ?" message="Elle sera retirée du calendrier. Cette action ne supprime rien chez le réseau." confirmLabel="Oui, supprimer" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </SafeAreaView>
  );
}
