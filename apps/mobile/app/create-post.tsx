import { Ionicons } from "@expo/vector-icons";
import { addHours, format, set } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo, useRef, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect } from "react";

import { PostPreview } from "@/components/post-preview/post-preview";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { DateTimeSheet } from "@/components/ui/datetime-sheet";
import { IconCircle, OutlineButton, PrimaryButton, Sheet } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { NETWORK_LIMITS } from "@/lib/agent";
import { formatNetworkLabel } from "@/lib/networks";
import { useChannelsStore } from "@/store/channels-store";
import { usePostsStore, type SaveAction } from "@/store/posts-store";
import type { Channel } from "@/types";
import { htmlToPlain, capFirst } from "@/utils/text";

const nextHour = () => set(addHours(new Date(), 1), { minutes: 0, seconds: 0, milliseconds: 0 });

export default function CreatePostScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ postId?: string; dateTime?: string; channelId?: string }>();
  const allChannels = useChannelsStore((s) => s.channels);
  const posts = usePostsStore((s) => s.posts);
  const channels = useMemo(() => allChannels.filter((c) => (c.status ?? "active") === "active"), [allChannels]);

  const initialEdit = params.postId ? posts.find((p) => p.id === params.postId) : undefined;

  const [editId, setEditId] = useState<string | undefined>(initialEdit?.id);
  const [blocks, setBlocks] = useState<string[]>(() =>
    initialEdit ? (initialEdit.composerPosts ?? [{ id: initialEdit.id, content: initialEdit.content, imageUris: [] }]).map((b) => htmlToPlain(b.content)) : [""],
  );
  const [selected, setSelected] = useState<string[]>(() => {
    if (initialEdit) return [initialEdit.channelId];
    if (params.channelId) return [params.channelId];
    return channels.length > 0 && channels.length <= 3 ? channels.map((c) => c.id) : [];
  });
  const selectionTouched = useRef(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [publishAt, setPublishAt] = useState<Date>(() => (initialEdit ? new Date(initialEdit.scheduledAt) : params.dateTime ? new Date(params.dateTime) : nextHour()));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [channelSheet, setChannelSheet] = useState(false);
  const [publishSheet, setPublishSheet] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
  const [draftsSheet, setDraftsSheet] = useState(false);
  const [menuSheet, setMenuSheet] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);

  const selectedChannels = useMemo(() => channels.filter((c) => selected.includes(c.id)), [channels, selected]);
  const editing = !!editId;
  const hasContent = blocks.some((b) => b.trim()) || Object.values(overrides).some((o) => o.trim());

  const threadFor = (c: Channel) => (overrides[c.id] !== undefined ? [overrides[c.id]] : blocks).map((t) => t.trim()).filter(Boolean);
  const limitOf = (c: Channel) => NETWORK_LIMITS[c.network] ?? Infinity;
  const lengthOf = (c: Channel) => Math.max(0, ...threadFor(c).map((t) => t.length));

  const problems: string[] = [];
  if (selectedChannels.length === 0) problems.push("Choisissez au moins un canal.");
  if (selectedChannels.length > 0 && selectedChannels.some((c) => threadFor(c).length === 0)) problems.push("Écrivez un texte.");
  for (const c of selectedChannels) if (lengthOf(c) > limitOf(c)) problems.push(`${formatNetworkLabel(c.network)} : ${lengthOf(c)} / ${limitOf(c)} caractères.`);
  const inPast = publishAt.getTime() < Date.now() + 60_000;

  const requestClose = () => {
    if (dirty && hasContent) setLeaveSheet(true);
    else router.back();
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  });

  const touch = () => setDirty(true);

  // Les canaux peuvent arriver après l'ouverture de l'écran : tant que rien n'a été choisi, on propose tous les canaux (jusqu'à 3).
  useEffect(() => {
    if (selectionTouched.current || initialEdit || params.channelId) return;
    setSelected(channels.length > 0 && channels.length <= 3 ? channels.map((c) => c.id) : []);
  }, [channels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (action: SaveAction) => {
    if (problems.length > 0) {
      showToast(problems[0], "error");
      return;
    }
    if (action === "calendar" && inPast) {
      showToast("Choisissez une date dans le futur.", "error");
      return;
    }
    setSaving(true);
    const items = selectedChannels.map((c) => ({ channelId: c.id, thread: threadFor(c) }));
    const result = await usePostsStore.getState().savePosts({ action, publishAt, items: editId ? [items[0]] : items, editPostId: editId });
    setSaving(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    usePostsStore.getState().setNavigateToDate((action === "now" ? new Date() : publishAt).toISOString());
    showToast(action === "draft" ? "Brouillon enregistré" : action === "now" ? "Publication mise en file d’envoi" : editing ? "Publication modifiée" : "Publication programmée", "success");
    setPublishSheet(false);
    setDirty(false);
    router.back();
  };

  const openDraft = (id: string) => {
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    setEditId(p.id);
    setBlocks((p.composerPosts ?? [{ id: p.id, content: p.content, imageUris: [] }]).map((b) => htmlToPlain(b.content)));
    setSelected([p.channelId]);
    setOverrides({});
    setPublishAt(new Date(p.scheduledAt));
    setDraftsSheet(false);
  };

  const removePost = async () => {
    if (!editId) return;
    const result = await usePostsStore.getState().deletePost(editId);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    showToast("Publication supprimée", "success");
    router.back();
  };

  const drafts = posts.filter((p) => p.dbState === "draft" && p.id !== editId);

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="h-[64px] flex-row items-center justify-between gap-3 px-4">
          <IconCircle icon="close" label="Fermer" onPress={requestClose} />
          <Text numberOfLines={1} className="flex-1 text-center font-jakarta text-[18px] font-semibold text-ink">
            {editing ? "Modifier le post" : "Nouveau post"}
          </Text>
          <IconCircle icon="ellipsis-vertical" label="Plus d’actions" onPress={() => setMenuSheet(true)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continuer"
            onPress={() => setPublishSheet(true)}
            className="h-[44px] w-[44px] items-center justify-center rounded-full bg-brand"
          >
            <Ionicons name="arrow-forward" size={22} color="#141414" />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 6, gap: 12, alignItems: "center" }}>
            {selectedChannels.map((c) => (
              <Pressable key={c.id} onPress={() => !editing && setChannelSheet(true)} accessibilityLabel={`${c.name}, ${formatNetworkLabel(c.network)}`}>
                <ChannelAvatar avatar={c.avatar} network={c.network} name={c.name} size={52} />
              </Pressable>
            ))}
            {editing ? null : (
              <Pressable accessibilityLabel="Choisir les canaux" onPress={() => setChannelSheet(true)} className="h-[52px] w-[52px] items-center justify-center rounded-full bg-chip-bg">
                <Ionicons name="add" size={26} color="#141414" />
              </Pressable>
            )}
            {selectedChannels.length === 0 ? <Text className="font-jakarta text-[14px] text-ink-soft">Choisissez où publier</Text> : null}
          </ScrollView>

          <View className="mx-4 flex-row rounded-full bg-chip-bg p-[4px]">
            {(["write", "preview"] as const).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} className={`h-[38px] flex-1 items-center justify-center rounded-full ${tab === t ? "bg-card" : ""}`}>
                <Text className={`font-jakarta text-[15px] ${tab === t ? "font-semibold text-ink" : "text-ink-soft"}`}>{t === "write" ? "Rédaction" : "Aperçu"}</Text>
              </Pressable>
            ))}
          </View>

          {tab === "write" ? (
            <>
              <View className="gap-3 px-4">
                {blocks.map((b, i) => (
                  <View key={i} className="rounded-[22px] border border-line bg-card p-4">
                    <TextInput
                      className="min-h-[110px] font-jakarta text-[18px] leading-[26px] text-ink"
                      style={{ textAlignVertical: "top" }}
                      placeholder={i === 0 ? "Commencez à écrire…" : "Suite du fil…"}
                      placeholderTextColor="#9A9890"
                      selectionColor="#141414"
                      multiline
                      autoFocus={i === 0 && !editing}
                      value={b}
                      onChangeText={(t) => {
                        setBlocks((cur) => cur.map((x, j) => (j === i ? t : x)));
                        touch();
                      }}
                    />
                    {blocks.length > 1 ? (
                      <Pressable hitSlop={8} className="self-end pt-1" onPress={() => { setBlocks((cur) => cur.filter((_, j) => j !== i)); touch(); }}>
                        <Text className="font-jakarta text-[13px] font-semibold text-text-critical">Retirer ce message</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable hitSlop={6} className="flex-row items-center gap-2 self-start py-1" onPress={() => { setBlocks((cur) => [...cur, ""]); touch(); }}>
                  <Ionicons name="add-circle-outline" size={20} color="#2F4A00" />
                  <Text className="font-jakarta text-[14px] font-semibold text-brand-ink">Ajouter un message au fil</Text>
                </Pressable>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                <Pressable onPress={() => showToast("L’envoi d’images et de vidéos arrive bientôt.", "info")} className="h-[48px] flex-row items-center gap-2 rounded-full bg-chip-bg px-5">
                  <Ionicons name="attach" size={20} color="#141414" />
                  <Text className="font-jakarta text-[15px] font-medium text-ink">Joindre une photo ou vidéo</Text>
                </Pressable>
                <Pressable onPress={() => router.replace("/(tabs)/agent" as never)} className="h-[48px] flex-row items-center gap-2 rounded-full bg-chip-bg px-5">
                  <Ionicons name="sparkles-outline" size={19} color="#141414" />
                  <Text className="font-jakarta text-[15px] font-medium text-ink">Écrire avec l’agent</Text>
                </Pressable>
                {drafts.length > 0 ? (
                  <Pressable onPress={() => setDraftsSheet(true)} className="h-[48px] flex-row items-center gap-2 rounded-full bg-chip-bg px-5">
                    <Ionicons name="folder-open-outline" size={20} color="#141414" />
                    <Text className="font-jakarta text-[15px] font-medium text-ink">Ouvrir un brouillon</Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              <View className="gap-3 px-4">
                {selectedChannels.map((c) => {
                  const over = lengthOf(c) > limitOf(c);
                  const custom = overrides[c.id] !== undefined;
                  return (
                    <View key={c.id} className="rounded-[22px] border border-line bg-card p-4">
                      <View className="flex-row items-center gap-3">
                        <ChannelAvatar avatar={c.avatar} network={c.network} name={c.name} size={36} />
                        <View className="min-w-0 flex-1">
                          <Text numberOfLines={1} className="font-jakarta text-[15px] font-semibold text-ink">{c.name}</Text>
                          <Text className="font-jakarta text-[12px] text-ink-soft">{formatNetworkLabel(c.network)}</Text>
                        </View>
                        <Text className={`font-jakarta text-[13px] font-semibold ${over ? "text-text-critical" : "text-ink-soft"}`}>
                          {lengthOf(c)}
                          {Number.isFinite(limitOf(c)) ? ` / ${limitOf(c)}` : ""}
                        </Text>
                      </View>
                      {custom ? (
                        <View className="mt-3 gap-2">
                          <TextInput
                            className="min-h-[80px] rounded-[16px] border border-line bg-canvas p-3 font-jakarta text-[16px] leading-[22px] text-ink"
                            style={{ textAlignVertical: "top" }}
                            multiline
                            value={overrides[c.id]}
                            onChangeText={(t) => { setOverrides((cur) => ({ ...cur, [c.id]: t })); touch(); }}
                          />
                          <Pressable hitSlop={8} onPress={() => setOverrides((cur) => { const n = { ...cur }; delete n[c.id]; return n; })}>
                            <Text className="font-jakarta text-[13px] font-semibold text-brand-ink">Revenir au texte commun</Text>
                          </Pressable>
                        </View>
                      ) : blocks.length === 1 ? (
                        <Pressable hitSlop={8} className="mt-3" onPress={() => { setOverrides((cur) => ({ ...cur, [c.id]: blocks[0] })); touch(); }}>
                          <Text className="font-jakarta text-[14px] font-semibold text-brand-ink">Personnaliser le texte pour {formatNetworkLabel(c.network)}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <View className="gap-5 px-4">
              {selectedChannels.length === 0 ? <Text className="font-jakarta text-[15px] text-ink-soft">Choisissez un canal pour voir l’aperçu.</Text> : null}
              {selectedChannels.map((c) => (
                <PostPreview key={c.id} network={c.network} name={c.name} username={c.username} avatar={c.avatar || undefined} thread={threadFor(c).length ? threadFor(c) : [""]} date={publishAt.toISOString()} />
              ))}
              <Text className="font-jakarta text-[12px] text-ink-muted">Aperçu indicatif : l’affichage réel dépend du réseau et de l’appareil.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={channelSheet} onClose={() => setChannelSheet(false)} title="Choisir les canaux" right={<IconCircle icon="checkmark" label="Terminé" onPress={() => setChannelSheet(false)} active />}>
        <View className="mb-2 flex-row">
          <Pressable className="h-[40px] items-center justify-center rounded-full bg-chip-bg px-4" onPress={() => { selectionTouched.current = true; setSelected(selected.length === channels.length ? [] : channels.map((c) => c.id)); }}>
            <Text className="font-jakarta text-[14px] font-medium text-ink">{selected.length === channels.length ? "Désélectionner tous les canaux" : "Sélectionner tous les canaux"}</Text>
          </Pressable>
        </View>
        <View className="overflow-hidden rounded-[22px] bg-card">
          {channels.map((c, i) => {
            const on = selected.includes(c.id);
            return (
              <Pressable key={c.id} onPress={() => { selectionTouched.current = true; setSelected((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id])); touch(); }} className={`flex-row items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                <ChannelAvatar avatar={c.avatar} network={c.network} name={c.name} size={44} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-jakarta text-[16px] font-medium text-ink">{c.name}</Text>
                  <Text className="font-jakarta text-[13px] text-ink-soft">{formatNetworkLabel(c.network)}</Text>
                </View>
                <View className={`h-[26px] w-[26px] items-center justify-center rounded-full border ${on ? "border-brand bg-brand" : "border-[#C9C7C0]"}`}>
                  {on ? <Ionicons name="checkmark" size={16} color="#141414" /> : null}
                </View>
              </Pressable>
            );
          })}
          <Pressable onPress={() => { setChannelSheet(false); setTimeout(() => router.push("/add-channel"), 250); }} className="flex-row items-center gap-3 border-t border-line px-4 py-4">
            <View className="h-[44px] w-[44px] items-center justify-center rounded-full bg-chip-bg">
              <Ionicons name="add" size={22} color="#141414" />
            </View>
            <Text className="font-jakarta text-[16px] text-ink">Connecter un nouveau canal</Text>
          </Pressable>
        </View>
      </Sheet>

      <Sheet visible={publishSheet} onClose={() => setPublishSheet(false)} title={editing ? "Enregistrer" : "Publier"}>
        <View className="gap-3 pb-2">
          <View className="flex-row items-center gap-2">
            {selectedChannels.slice(0, 6).map((c) => (
              <ChannelAvatar key={c.id} avatar={c.avatar} network={c.network} name={c.name} size={34} />
            ))}
            <Text className="flex-1 pl-1 font-jakarta text-[14px] text-ink-soft">
              {selectedChannels.length > 1 ? `${selectedChannels.length} canaux` : "1 canal"}
            </Text>
          </View>

          <Pressable onPress={() => setDateSheet(true)} className="flex-row items-center gap-3 rounded-[20px] border border-line bg-card px-4 py-4">
            <Ionicons name="calendar-outline" size={22} color="#141414" />
            <View className="flex-1">
              <Text className="font-jakarta text-[12px] text-ink-soft">Date de publication</Text>
              <Text className="font-jakarta text-[16px] font-semibold text-ink">{capFirst(format(publishAt, "EEEE d MMMM 'à' HH:mm", { locale: fr }))}</Text>
            </View>
            <Text className="font-jakarta text-[14px] font-semibold text-brand-ink">Modifier</Text>
          </Pressable>

          {problems.length > 0 ? (
            <View className="rounded-[16px] bg-[#FDE7E4] px-4 py-3">
              {problems.map((p) => (
                <Text key={p} className="font-jakarta text-[13px] text-text-critical">{p}</Text>
              ))}
            </View>
          ) : null}
          {problems.length === 0 && inPast ? <Text className="font-jakarta text-[13px] text-text-critical">La date est dans le passé : choisissez-en une autre pour programmer.</Text> : null}

          <PrimaryButton label={editing ? "Enregistrer et programmer" : "Programmer"} onPress={() => submit("calendar")} loading={saving} disabled={problems.length > 0 || inPast} />
          <OutlineButton label="Publier maintenant" onPress={() => submit("now")} disabled={problems.length > 0 || saving} />
          <Pressable className="h-[48px] items-center justify-center" disabled={saving} onPress={() => submit("draft")}>
            <Text className="font-jakarta text-[16px] font-semibold text-brand-ink">Enregistrer en brouillon</Text>
          </Pressable>
        </View>
      </Sheet>

      <DateTimeSheet visible={dateSheet} onClose={() => setDateSheet(false)} value={publishAt} onSave={(d) => { setPublishAt(d); setDateSheet(false); touch(); }} title="Date et heure" />

      <Sheet visible={draftsSheet} onClose={() => setDraftsSheet(false)} title="Ouvrir un brouillon">
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          <View className="overflow-hidden rounded-[22px] bg-card">
            {drafts.map((d, i) => (
              <Pressable key={d.id} onPress={() => openDraft(d.id)} className={`flex-row items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                <ChannelAvatar avatar={d.authorAvatar} network={d.network} name={d.authorName} size={40} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={2} className="font-jakarta text-[15px] text-ink">{htmlToPlain(d.content) || "(sans texte)"}</Text>
                  <Text className="font-jakarta text-[12px] text-ink-soft">{formatNetworkLabel(d.network)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </Sheet>

      <Sheet visible={menuSheet} onClose={() => setMenuSheet(false)} title="Actions">
        <View className="overflow-hidden rounded-[22px] bg-card">
          {[
            { icon: "save-outline" as const, label: "Enregistrer en brouillon", run: () => submit("draft") },
            { icon: "backspace-outline" as const, label: "Effacer le texte", run: () => { setBlocks([""]); setOverrides({}); touch(); } },
            ...(editing ? [{ icon: "trash-outline" as const, label: "Supprimer la publication", danger: true, run: removePost }] : []),
          ].map((row, i) => (
            <Pressable key={row.label} onPress={() => { setMenuSheet(false); setTimeout(() => void row.run(), 250); }} className={`flex-row items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-line" : ""}`}>
              <Ionicons name={row.icon} size={22} color={"danger" in row && row.danger ? "#D92D20" : "#141414"} />
              <Text className={`font-jakarta text-[17px] ${"danger" in row && row.danger ? "text-text-critical" : "text-ink"}`}>{row.label}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={leaveSheet} onClose={() => setLeaveSheet(false)} title="Quitter ?">
        <View className="gap-3 pb-2">
          <Text className="font-jakarta text-[15px] text-ink-soft">Votre texte n’est pas enregistré.</Text>
          <PrimaryButton label="Enregistrer en brouillon" onPress={() => { setLeaveSheet(false); void submit("draft"); }} />
          <OutlineButton label="Abandonner" danger onPress={() => { setDirty(false); setLeaveSheet(false); router.back(); }} />
          <Pressable className="h-[44px] items-center justify-center" onPress={() => setLeaveSheet(false)}>
            <Text className="font-jakarta text-[16px] font-semibold text-brand-ink">Continuer à écrire</Text>
          </Pressable>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
