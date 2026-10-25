import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { GeneratedImages } from "@/components/agent/generated-images";
import { ProposalSet } from "@/components/agent/proposal-set";
import { VideoJobCard } from "@/components/agent/video-job-card";
import { HeaderActions } from "@/components/home/header-actions";
import { MediaPickerSheet } from "@/components/media/media-picker-sheet";
import { MediaThumb } from "@/components/media/media-thumb";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { IconCircle, PrimaryButton, Sheet } from "@/components/ui/kit";
import { TAB_BAR_HEIGHT } from "@/components/ui/main-tab-navbar";
import { agentConfigured, MAX_MEDIA_PER_MESSAGE, MAX_MESSAGE_LENGTH, NETWORK_LIMITS, NOT_CONFIGURED } from "@/lib/agent";
import type { AgentMessage, AgentToolName } from "@/lib/agent-protocol";
import { DEMO } from "@/lib/demo";
import { haptic } from "@/lib/haptics";
import type { MediaItem } from "@/lib/media";
import { useAgentStore } from "@/store/agent-store";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";

// L'agent du mobile est celui du web (même modèle, mêmes règles, mêmes conversations) : voir lib/agent.ts.

const SUGGESTIONS = [
  "Annonce l’ouverture de notre atelier ce samedi, sur un ton chaleureux.",
  "Prépare une publication sur notre nouveauté de la semaine pour tous mes canaux.",
  "Qu’est-ce qui est déjà programmé cette semaine ?",
  "Écris un post LinkedIn pour demain matin sur les coulisses de notre équipe.",
];

const WORKING: Record<AgentToolName, string> = {
  list_posts: "Consulte le calendrier…",
  list_media: "Cherche dans la bibliothèque de médias…",
  propose_posts: "Prépare les publications…",
  generate_image: "Génère l’image…",
  generate_video: "Lance la vidéo…",
  video_status: "Vérifie la vidéo…",
  search_knowledge: "Consulte la base de connaissance…",
};

const FALLBACK = "Voici ce que j’ai préparé. Relisez chaque publication, modifiez-la au besoin, puis enregistrez-la en brouillon ou programmez-la.";

function AgentAvatar() {
  return (
    <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-brand">
      <Ionicons name="sparkles" size={16} color="#141414" />
    </View>
  );
}

function UserBubble({ message }: { message: AgentMessage }) {
  const media = useAgentStore((s) => s.media);
  const attached = message.mediaIds.flatMap((id) => (media[id] ? [media[id]!] : []));
  return (
    <View className="max-w-[86%] self-end gap-2 rounded-[22px] rounded-br-[8px] bg-ink px-4 py-3">
      {attached.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {attached.map((m) => <MediaThumb key={m.id} uri={m.thumbUrl ?? m.url} kind={m.kind} size={56} radius={12} />)}
        </View>
      ) : null}
      {message.text ? <Text className="font-jakarta text-[14.5px] leading-[21px] text-white">{message.text}</Text> : null}
    </View>
  );
}

export default function AgentScreen() {
  const insets = useSafeAreaInsets();
  const org = useOrgStore((s) => s.current);
  const canWrite = useOrgStore((s) => s.canWrite);
  const all = useChannelsStore((s) => s.channels);
  const channels = useMemo(() => all.filter((c) => (c.status ?? "active") === "active" && NETWORK_LIMITS[c.network]), [all]);

  const { messages, pendingUser, run, error, threads, activeId, jobs } = useAgentStore();
  const media = useAgentStore((s) => s.media);

  const [selected, setSelected] = useState<string[]>(() => channels.map((c) => c.id));
  const touched = useRef(false);
  // Les canaux peuvent arriver après l'ouverture de l'écran : tant que l'utilisateur n'a rien choisi, on les sélectionne tous.
  useEffect(() => {
    if (!touched.current) setSelected(channels.map((c) => c.id));
  }, [channels]);

  const [draft, setDraft] = useState("");
  const [attached, setAttached] = useState<MediaItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (org) void useAgentStore.getState().loadThreads();
  }, [org]);

  const picked = useMemo(() => channels.filter((c) => selected.includes(c.id)), [channels, selected]);
  const busy = run !== null;
  const configured = DEMO || agentConfigured();
  const ready = canWrite && configured;

  const toggle = (id: string) => {
    haptic.select();
    touched.current = true;
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (busy || !ready || (!text && attached.length === 0)) return;
    haptic.tap();
    const sentMedia = attached;
    setDraft("");
    setAttached([]);
    const saved = await useAgentStore.getState().send({ text, channels: picked, media: sentMedia });
    // Rien n'a été enregistré : le message revient dans le champ, prêt à être renvoyé.
    if (!saved) {
      setDraft(text);
      setAttached(sentMedia);
    }
  };

  // « Préparer une publication avec cette vidéo » : la vidéo rejoint les pièces jointes et le champ propose la demande ; l'utilisateur l'envoie quand il veut.
  const attachVideo = (video: MediaItem) => {
    haptic.tap();
    setAttached((cur) => (cur.some((m) => m.id === video.id) ? cur : [...cur, video].slice(0, MAX_MEDIA_PER_MESSAGE)));
    setDraft((d) => d || "Prépare une publication avec cette vidéo.");
  };

  const confirmDelete = (id: string, title: string) =>
    Alert.alert("Supprimer la conversation ?", title, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => void useAgentStore.getState().removeThread(id) },
    ]);

  const shown = pendingUser ? [...messages, pendingUser] : messages;
  const empty = shown.length === 0 && !run;
  const noChannel = ready && picked.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />

      <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
        <Text className="font-jakarta text-[27px] font-semibold text-ink">Agent</Text>
        <View className="flex-row items-center gap-2">
          <IconCircle icon="time-outline" label="Conversations" size={44} onPress={() => setHistoryOpen(true)} />
          <IconCircle icon="create-outline" label="Nouvelle conversation" size={44} onPress={() => useAgentStore.getState().newThread()} />
          <HeaderActions />
        </View>
      </View>

      {channels.length === 0 ? (
        <Text className="px-4 pb-2 font-jakarta text-[13px] text-ink-soft">Aucun canal actif. Connectez un canal depuis le menu du compte.</Text>
      ) : (
        <View>
          <Text className="px-4 pb-1.5 font-jakarta text-[12px] text-ink-soft">L’agent n’utilise que les canaux cochés.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {channels.map((c) => {
              const on = selected.includes(c.id);
              return (
                <Pressable
                  key={c.id} accessibilityRole="button" accessibilityState={{ selected: on }} disabled={busy} onPress={() => toggle(c.id)}
                  className={`h-[44px] flex-row items-center gap-2 rounded-full border pl-1.5 pr-3.5 ${on ? "border-ink bg-card" : "border-line bg-card opacity-60"}`}
                >
                  <ChannelAvatar avatar={c.avatar} network={c.network} name={c.name} size={30} badge={false} />
                  <Text numberOfLines={1} className="max-w-[130px] font-jakarta text-[13px] font-medium text-ink">{c.name}</Text>
                  {on ? <Ionicons name="checkmark-circle" size={17} color="#2F4A00" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scroller} className="flex-1" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 18, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}
          onContentSizeChange={() => { if (!empty) scroller.current?.scrollToEnd({ animated: true }); }}
        >
          {empty ? (
            <View className="items-center gap-3 pt-6">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-brand">
                <Ionicons name="sparkles" size={22} color="#141414" />
              </View>
              <Text className="text-center font-jakarta text-[20px] font-semibold text-ink">Bonjour, je suis votre agent Postbiz.</Text>
              <Text className="text-center font-jakarta text-[13.5px] leading-[20px] text-ink-soft">
                Décrivez ce que vous voulez publier : je prépare une publication pour chaque canal coché. Vous la relisez, la modifiez, puis vous l’enregistrez en brouillon ou la programmez. Rien n’est publié sans votre action.
              </Text>
              {ready ? (
                <View className="mt-2 w-full gap-2">
                  <Text className="font-jakarta text-[12px] font-semibold text-ink-soft">Essayez par exemple</Text>
                  {SUGGESTIONS.map((s) => (
                    <Pressable key={s} accessibilityRole="button" onPress={() => { haptic.tap(); setDraft(s); }} className="rounded-[18px] border border-line bg-card px-4 py-3">
                      <Text className="font-jakarta text-[13.5px] leading-[19px] text-ink">{s}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            shown.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} message={m} />
              ) : (
                <View key={m.id} className="flex-row gap-3">
                  <AgentAvatar />
                  <View className="min-w-0 flex-1">
                    <Text className="font-jakarta text-[14.5px] leading-[21px] text-ink">{m.text || (m.proposals.length > 0 ? FALLBACK : "")}</Text>
                    <GeneratedImages items={m.mediaIds.flatMap((id) => (media[id] ? [media[id]!] : []))} />
                    {m.jobIds.map((id) => (jobs[id] ? <VideoJobCard key={id} job={jobs[id]!} canWrite={canWrite} onUse={attachVideo} /> : null))}
                    {m.proposals.length > 0 ? <ProposalSet message={m} canWrite={canWrite} /> : null}
                  </View>
                </View>
              ),
            )
          )}
          {run ? (
            <View className="flex-row gap-3">
              <AgentAvatar />
              <View className="min-w-0 flex-1 gap-1.5">
                {run.text ? <Text className="font-jakarta text-[14.5px] leading-[21px] text-ink">{run.text}</Text> : null}
                <GeneratedImages items={run.images} />
                {run.jobs.map((id) => (jobs[id] ? <VideoJobCard key={id} job={jobs[id]!} canWrite={canWrite} onUse={attachVideo} /> : null))}
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#6B6A64" />
                  <Text className="font-jakarta text-[12.5px] text-ink-soft">{run.tool ? WORKING[run.tool] : "L’agent réfléchit…"}</Text>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* La barre flottante couvre le bas de l'écran : le champ de saisie se place au-dessus, sauf quand le clavier la recouvre. */}
        <View style={{ paddingHorizontal: 16, paddingBottom: keyboard ? 8 : TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) - 8, gap: 8 }}>
          {DEMO ? <Text className="rounded-[14px] bg-chip-bg px-3 py-1.5 text-center font-jakarta text-[12px] text-ink-soft">Mode démo : les réponses de l’agent sont simulées, aucune IA n’est appelée.</Text> : null}
          {!canWrite ? <Text className="font-jakarta text-[12.5px] text-ink-soft">Votre rôle (lecteur) ne permet pas d’utiliser l’agent.</Text> : null}
          {canWrite && !configured ? <Text className="rounded-[14px] bg-chip-bg px-3 py-2 font-jakarta text-[12.5px] text-ink-soft">{NOT_CONFIGURED}</Text> : null}
          {noChannel ? <Text className="font-jakarta text-[12.5px] font-medium text-text-critical">Cochez au moins un canal pour que l’agent puisse préparer des publications.</Text> : null}
          {error ? (
            <Pressable accessibilityRole="alert" onPress={() => useAgentStore.getState().clearError()} className="rounded-[14px] bg-[#FCE8E6] px-3 py-2">
              <Text className="font-jakarta text-[12.5px] font-medium text-text-critical">{error}</Text>
            </Pressable>
          ) : null}
          {attached.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {attached.map((m) => (
                <View key={m.id}>
                  <MediaThumb uri={m.thumbUrl ?? m.url} kind={m.kind} size={52} />
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`Retirer ${m.name}`} onPress={() => setAttached((cur) => cur.filter((x) => x.id !== m.id))}
                    className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-ink"
                  >
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
          <View className="flex-row items-end gap-2 rounded-[28px] border border-line bg-card p-1.5">
            <IconCircle icon="image-outline" label="Joindre des médias de la bibliothèque" size={44} onPress={ready && !busy && attached.length < MAX_MEDIA_PER_MESSAGE ? () => setPickerOpen(true) : undefined} />
            <TextInput
              className="max-h-[140px] min-h-[44px] flex-1 px-1 py-2.5 font-jakarta text-[14.5px] leading-[20px] text-ink"
              placeholder="Décrivez la publication à préparer…" placeholderTextColor="#9A9890" selectionColor="#141414"
              value={draft} onChangeText={(t) => setDraft(t.slice(0, MAX_MESSAGE_LENGTH))} multiline editable={ready}
            />
            {busy ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Arrêter" onPress={() => useAgentStore.getState().stop()} className="h-[44px] w-[44px] items-center justify-center rounded-full bg-ink">
                <Ionicons name="stop" size={16} color="#FFFFFF" />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button" accessibilityLabel="Envoyer" disabled={!ready || (!draft.trim() && attached.length === 0)} onPress={() => void send(draft)}
                className="h-[44px] w-[44px] items-center justify-center rounded-full bg-ink" style={{ opacity: !ready || (!draft.trim() && attached.length === 0) ? 0.3 : 1 }}
              >
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
          <Text className="text-center font-jakarta text-[10.5px] text-ink-muted">L’agent peut se tromper : relisez chaque publication avant de la programmer.</Text>
        </View>
      </KeyboardAvoidingView>

      <MediaPickerSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} initial={attached} onConfirm={(items) => { setAttached(items.slice(0, MAX_MEDIA_PER_MESSAGE)); setPickerOpen(false); }} />

      <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="Conversations">
        <View className="gap-2 pb-2">
          <PrimaryButton label="Nouvelle conversation" icon="add" onPress={() => { useAgentStore.getState().newThread(); setHistoryOpen(false); }} />
          {threads.length === 0 ? (
            <Text className="px-1 pt-3 font-jakarta text-[13.5px] text-ink-soft">Vos conversations apparaîtront ici.</Text>
          ) : (
            threads.map((t) => (
              <View key={t.id} className={`flex-row items-center rounded-[18px] ${t.id === activeId ? "bg-chip-bg" : ""}`}>
                <Pressable accessibilityRole="button" className="min-w-0 flex-1 px-4 py-3.5" onPress={() => { void useAgentStore.getState().openThread(t.id); setHistoryOpen(false); }}>
                  <Text numberOfLines={2} className="font-jakarta text-[14px] text-ink">{t.title}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer la conversation ${t.title}`} onPress={() => confirmDelete(t.id, t.title)} className="h-11 w-11 items-center justify-center">
                  <Ionicons name="trash-outline" size={18} color="#6B6A64" />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
