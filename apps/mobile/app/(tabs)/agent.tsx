import { Ionicons } from "@expo/vector-icons";
import { capFirst } from "@/utils/text";
import { addDays, format, set } from "date-fns";
import { fr } from "date-fns/locale";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderActions } from "@/components/home/header-actions";
import { PostPreview } from "@/components/post-preview/post-preview";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { DateTimeSheet } from "@/components/ui/datetime-sheet";
import { OutlineButton, PrimaryButton } from "@/components/ui/kit";
import { MainTabNavbar, TAB_BAR_HEIGHT } from "@/components/ui/main-tab-navbar";
import { showToast } from "@/components/ui/toast";
import { AGENT_TONES, composePosts, MAX_BRIEF_LENGTH, NETWORK_LIMITS, type AgentTone } from "@/lib/agent";
import { formatNetworkLabel } from "@/lib/networks";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";
import type { ChannelNetwork } from "@/types";

const tomorrowAtNine = () => set(addDays(new Date(), 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 });

const IDEAS = ["Nouveau produit ou offre du moment", "Annonce de nos horaires et jours fériés", "Coulisses : présenter l’équipe", "Un conseil utile pour nos clients"];

export default function AgentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const channels = useChannelsStore((s) => s.channels).filter((c) => (c.status ?? "active") === "active" && NETWORK_LIMITS[c.network]);
  const canWrite = useOrgStore((s) => s.canWrite);

  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<AgentTone>("professionnel");
  const [selected, setSelected] = useState<string[]>(() => channels.map((c) => c.id));
  const touched = useRef(false);
  // Les canaux peuvent arriver après l'ouverture de l'écran : tant que l'utilisateur n'a rien choisi, on les sélectionne tous.
  useEffect(() => {
    if (!touched.current) setSelected(channels.map((c) => c.id));
  }, [channels.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drafts, setDrafts] = useState<Partial<Record<ChannelNetwork, string>> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishAt, setPublishAt] = useState<Date>(tomorrowAtNine);
  const [dateOpen, setDateOpen] = useState(false);

  const selectedChannels = useMemo(() => channels.filter((c) => selected.includes(c.id)), [channels, selected]);
  const networks = useMemo(() => [...new Set(selectedChannels.map((c) => c.network))], [selectedChannels]);
  const toggle = (id: string) => {
    touched.current = true;
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const ready = brief.trim().length > 0 && networks.length > 0 && canWrite;

  const generate = async () => {
    setGenerating(true);
    const result = await composePosts(brief.trim(), networks, tone);
    setGenerating(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setDrafts(Object.fromEntries(result.drafts.map((d) => [d.network, d.text])));
  };

  const overLimit = drafts ? networks.some((n) => (drafts[n] ?? "").length > (NETWORK_LIMITS[n] ?? Infinity)) : false;
  const empty = drafts ? networks.some((n) => !(drafts[n] ?? "").trim()) : true;

  const save = async (action: "draft" | "calendar") => {
    if (!drafts) return;
    setSaving(true);
    const result = await usePostsStore.getState().savePosts({
      action,
      publishAt,
      items: selectedChannels.map((c) => ({ channelId: c.id, thread: [(drafts[c.network] ?? "").trim()] })),
    });
    setSaving(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    usePostsStore.getState().setNavigateToDate(publishAt.toISOString());
    showToast(action === "draft" ? "Brouillons enregistrés" : "Publications programmées", "success");
    setBrief("");
    setDrafts(null);
    router.replace("/(tabs)");
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />

      <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
        <Text className="font-jakarta text-[32px] font-semibold text-ink">Agent</Text>
        <HeaderActions />
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 18, paddingHorizontal: 16, paddingBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) + 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="gap-3 rounded-[26px] border border-line bg-card p-4">
            <View className="flex-row items-center gap-2">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-brand">
                <Ionicons name="sparkles" size={18} color="#141414" />
              </View>
              <Text className="flex-1 font-jakarta text-[17px] font-semibold text-ink">Que voulez-vous annoncer ?</Text>
            </View>
            <TextInput
              className="min-h-[110px] font-jakarta text-[17px] leading-[25px] text-ink"
              style={{ textAlignVertical: "top" }}
              placeholder="Ex. Nouveau pain aux noix dès samedi, offre de lancement pour les 20 premiers clients."
              placeholderTextColor="#9A9890"
              selectionColor="#141414"
              value={brief}
              onChangeText={(t) => setBrief(t.slice(0, MAX_BRIEF_LENGTH))}
              multiline
              editable={!generating}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {IDEAS.map((idea) => (
                <Pressable key={idea} onPress={() => setBrief(idea)} className="h-[38px] items-center justify-center rounded-full bg-chip-bg px-4">
                  <Text className="font-jakarta text-[13px] font-medium text-ink">{idea}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text className="text-right font-jakarta text-[11px] text-ink-muted">{brief.length}/{MAX_BRIEF_LENGTH}</Text>
          </View>

          <View className="gap-2">
            <Text className="px-1 font-jakarta text-[15px] font-semibold text-ink">Ton</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {AGENT_TONES.map((t) => (
                <Pressable key={t} onPress={() => setTone(t)} className={`h-[42px] items-center justify-center rounded-full border px-5 ${tone === t ? "border-ink bg-ink" : "border-line bg-card"}`}>
                  <Text className={`font-jakarta text-[15px] font-medium ${tone === t ? "text-white" : "text-ink"}`}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View className="gap-2">
            <Text className="px-1 font-jakarta text-[15px] font-semibold text-ink">Canaux</Text>
            {channels.length === 0 ? (
              <Text className="px-1 font-jakarta text-[15px] text-ink-soft">Aucun canal actif. Connectez un canal depuis le menu du compte.</Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {channels.map((c) => {
                  const on = selected.includes(c.id);
                  return (
                    <Pressable key={c.id} onPress={() => toggle(c.id)} className={`h-[48px] flex-row items-center gap-2 rounded-full border pl-2 pr-4 ${on ? "border-ink bg-card" : "border-line bg-card opacity-60"}`}>
                      <ChannelAvatar avatar={c.avatar} network={c.network} name={c.name} size={32} />
                      <Text numberOfLines={1} className="max-w-[150px] font-jakarta text-[15px] font-medium text-ink">{c.name}</Text>
                      {on ? <Ionicons name="checkmark-circle" size={18} color="#2F4A00" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <PrimaryButton label={generating ? "Rédaction en cours…" : drafts ? "Régénérer" : "Générer les publications"} icon="sparkles" onPress={generate} loading={generating} disabled={!ready} />
          {!canWrite ? <Text className="text-center font-jakarta text-[13px] text-ink-soft">Votre rôle (lecteur) ne permet pas de créer des publications.</Text> : null}

          {drafts ? (
            <View className="gap-5">
              <Text className="font-jakarta text-[22px] font-semibold text-ink">Propositions</Text>
              {networks.map((network) => {
                const text = drafts[network] ?? "";
                const limit = NETWORK_LIMITS[network] ?? Infinity;
                const channel = selectedChannels.find((c) => c.network === network)!;
                return (
                  <View key={network} className="gap-2">
                    <Text className="px-1 font-jakarta text-[14px] font-semibold text-ink-soft">{formatNetworkLabel(network)}</Text>
                    <PostPreview network={network} name={channel.name} username={channel.username} avatar={channel.avatar || undefined} thread={[text]} date={publishAt.toISOString()} />
                    <TextInput
                      className="min-h-[84px] rounded-[18px] border border-line bg-card p-3 font-jakarta text-[16px] leading-[23px] text-ink"
                      style={{ textAlignVertical: "top" }}
                      value={text}
                      onChangeText={(t) => setDrafts((cur) => ({ ...cur, [network]: t }))}
                      multiline
                    />
                    <Text className={`text-right font-jakarta text-[12px] ${text.length > limit ? "text-text-critical" : "text-ink-muted"}`}>
                      {text.length}
                      {Number.isFinite(limit) ? ` / ${limit}` : ""} caractères
                    </Text>
                  </View>
                );
              })}

              <Pressable className="flex-row items-center gap-3 rounded-[20px] border border-line bg-card px-4 py-4" onPress={() => setDateOpen(true)}>
                <Ionicons name="calendar-outline" size={22} color="#141414" />
                <View className="flex-1">
                  <Text className="font-jakarta text-[12px] text-ink-soft">Date de publication</Text>
                  <Text className="font-jakarta text-[16px] font-semibold text-ink">{capFirst(format(publishAt, "EEEE d MMMM 'à' HH:mm", { locale: fr }))}</Text>
                </View>
                <Text className="font-jakarta text-[14px] font-semibold text-brand-ink">Modifier</Text>
              </Pressable>

              {overLimit ? <Text className="font-jakarta text-[13px] text-text-critical">Un texte dépasse la limite de son réseau : raccourcissez-le avant de continuer.</Text> : null}

              <PrimaryButton label="Programmer" onPress={() => save("calendar")} loading={saving} disabled={empty || overLimit || publishAt.getTime() < Date.now() + 60_000} />
              <OutlineButton label="Enregistrer en brouillon" onPress={() => save("draft")} disabled={saving || empty || overLimit} />
              <Text className="font-jakarta text-[12px] leading-[18px] text-ink-muted">
                Relisez toujours avant de programmer : l’agent peut se tromper et n’invente ni chiffre ni offre qui ne soit pas dans votre brief.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <DateTimeSheet visible={dateOpen} onClose={() => setDateOpen(false)} value={publishAt} onSave={(d) => { setPublishAt(d); setDateOpen(false); }} />
      <MainTabNavbar activeTab="agent" />
    </SafeAreaView>
  );
}
