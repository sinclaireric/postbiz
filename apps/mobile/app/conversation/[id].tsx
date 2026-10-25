import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SuggestButton, SuggestFeedback, useReplySuggestion } from "@/components/inbox/reply-suggestion";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { haptic } from "@/lib/haptics";
import { Appear, EmptyState, IconCircle, PageHeader } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { MAX_REPLY_LENGTH, replyWindow, validateReply } from "@/lib/inbox/logic";
import type { DeliveryStatus, MessageItem } from "@/lib/inbox/types";
import { useNow } from "@/lib/use-now";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useOrgStore } from "@/store/org-store";

const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  received: "",
  queued: "En file d’envoi…",
  sending: "Envoi en cours…",
  sent: "Envoyé",
  failed: "Échec de l’envoi",
};

function Bubble({ message }: { message: MessageItem }) {
  const outgoing = message.direction === "out";
  return (
    <View className={`max-w-[85%] gap-1 ${outgoing ? "items-end self-end" : "items-start self-start"}`}>
      <View className={`rounded-[20px] px-4 py-3 ${outgoing ? "rounded-br-[6px] bg-brand" : "rounded-bl-[6px] border border-line bg-card"}`}>
        <Text className="font-jakarta text-[14.5px] leading-[19.5px] text-ink">{message.body || (message.attachments.length > 0 ? "Pièce jointe" : "")}</Text>
      </View>
      <Text className="font-jakarta text-[10px] text-ink-muted">
        {format(parseISO(message.createdAt), "d MMM, HH:mm", { locale: fr })}
        {outgoing && message.sentByName ? ` · ${message.sentByName}` : ""}
        {outgoing ? ` · ${DELIVERY_LABEL[message.deliveryStatus]}` : ""}
      </Text>
      {message.deliveryStatus === "failed" ? (
        <Text className="max-w-[270px] text-right font-jakarta text-[11px] leading-[15px] text-text-critical">
          {message.error ?? "Le message n’est pas parti."} Il n’est jamais renvoyé automatiquement : écrivez un nouveau message si besoin.
        </Text>
      ) : null}
    </View>
  );
}

export default function ConversationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useNow(30_000);
  const conversation = useInboxStore((s) => s.conversations.find((c) => c.id === id));
  const messages = useInboxStore((s) => (id ? s.messages[id] : undefined));
  const channel = useChannelsStore((s) => s.channels.find((c) => conversation && c.network === conversation.networkId && c.name === conversation.accountName));
  const canWrite = useOrgStore((s) => s.canWrite);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<MessageItem>>(null);
  const suggest = useReplySuggestion({ conversation, messages, draft, setDraft });
  const { settle } = suggest;

  useEffect(() => {
    if (!id) return;
    const store = useInboxStore.getState();
    store.setOpenConversation(id);
    void store.loadMessages(id);
    return () => useInboxStore.getState().setOpenConversation(null);
  }, [id]);

  // Tant que le fil est ouvert, un nouveau message entrant est aussitôt marqué comme lu.
  useEffect(() => {
    if (id && conversation && conversation.unreadCount > 0) void useInboxStore.getState().markRead(id);
  }, [id, conversation]);

  useEffect(() => {
    if (messages?.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages?.length]);

  const window = replyWindow(conversation?.replyWindowExpiresAt ?? null, now);
  const closed = conversation?.status === "closed";
  const validation = validateReply(draft, window);
  const canSend = canWrite && !sending && !validation;
  const expired = window.state === "expired";

  const send = useCallback(async () => {
    if (!id || !canSend) return;
    setSending(true);
    const result = await useInboxStore.getState().sendReply(id, draft);
    setSending(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    haptic.success();
    settle(draft); // la réponse partait peut-être d'une suggestion : on note si elle est partie telle quelle ou modifiée (sans attendre, sans gêner l'envoi)
    setDraft("");
  }, [id, draft, canSend, settle]);

  const toggleClosed = useCallback(async () => {
    if (!id) return;
    const result = await useInboxStore.getState().setStatus(id, closed ? "open" : "closed");
    if (!result.ok) showToast(result.error, "error");
  }, [id, closed]);

  if (!conversation) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
        <StatusBar style="dark" />
        <PageHeader title="Conversation" onBack={() => router.back()} />
        <EmptyState icon="chatbubble-outline" title="Conversation introuvable" primary={{ label: "Retour", onPress: () => router.back() }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="h-[68px] flex-row items-center gap-3 px-4">
          <IconCircle icon="chevron-back" label="Retour" onPress={() => router.back()} />
          <ChannelAvatar avatar={channel?.avatar} network={conversation.networkId} name={conversation.contactName} size={42} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-jakarta text-[15px] font-semibold text-ink">{conversation.contactName}</Text>
            <Text numberOfLines={1} className="font-jakarta text-[11px] text-ink-soft">
              {conversation.accountName}
              {conversation.contactUsername ? ` · @${conversation.contactUsername}` : ""}
            </Text>
          </View>
          {canWrite ? (
            <Pressable hitSlop={8} onPress={toggleClosed} className="h-[40px] items-center justify-center rounded-full bg-card px-4">
              <Text className="font-jakarta text-[12.5px] font-semibold text-brand-ink">{closed ? "Rouvrir" : "Résoudre"}</Text>
            </Pressable>
          ) : null}
        </View>

        {window.state !== "none" ? (
          <View className={`mx-4 mb-2 flex-row items-center gap-2 rounded-[16px] px-4 py-3 ${expired ? "bg-[#FDE7E4]" : window.state === "urgent" ? "bg-[#FFF1CC]" : "bg-brand-soft"}`}>
            <Ionicons name={expired ? "alert-circle" : "time"} size={18} color={expired ? "#B42318" : window.state === "urgent" ? "#8A5A00" : "#2F4A00"} />
            <Text className={`flex-1 font-jakarta text-[12px] font-semibold ${expired ? "text-text-critical" : window.state === "urgent" ? "text-[#8A5A00]" : "text-brand-ink"}`}>
              {expired ? "Fenêtre de 24 h dépassée : Meta n’autorise plus de réponse à cette conversation." : `${window.label} (24 h après le dernier message du client)`}
            </Text>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          className="flex-1 px-4"
          contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
          data={messages ?? []}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <Appear from="up">
              <Bubble message={item} />
            </Appear>
          )}
          ListEmptyComponent={messages === undefined ? undefined : <Text className="mt-10 text-center font-jakarta text-[13.5px] text-ink-soft">Aucun message.</Text>}
        />

        {canWrite ? (
          <View className="gap-1 px-4 pb-2 pt-2">
            <SuggestButton suggest={suggest} disabled={expired || sending} />
            {draft.length > MAX_REPLY_LENGTH - 200 ? (
              <Text className={`text-right font-jakarta text-[10px] ${draft.length > MAX_REPLY_LENGTH ? "text-text-critical" : "text-ink-muted"}`}>
                {draft.length}/{MAX_REPLY_LENGTH}
              </Text>
            ) : null}
            <View className="flex-row items-end gap-2">
              <TextInput
                className="max-h-[130px] min-h-[52px] flex-1 rounded-[26px] border border-line bg-card px-5 py-[14px] font-jakarta text-[14.5px] text-ink"
                placeholder={expired ? "Réponse impossible : fenêtre dépassée" : "Votre réponse"}
                placeholderTextColor="#9A9890"
                value={draft}
                onChangeText={setDraft}
                editable={!expired}
                multiline
              />
              <Pressable accessibilityLabel="Envoyer" disabled={!canSend} onPress={send} className={`h-[52px] w-[52px] items-center justify-center rounded-full ${canSend ? "bg-brand" : "bg-chip-bg"}`}>
                <Ionicons name="arrow-up" size={24} color={canSend ? "#141414" : "#9A9890"} />
              </Pressable>
            </View>
            <SuggestFeedback suggest={suggest} />
          </View>
        ) : (
          <Text className="px-4 pb-3 pt-2 text-center font-jakarta text-[12px] text-ink-soft">Votre rôle (lecteur) ne permet pas de répondre.</Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
