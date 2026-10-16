import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { showToast } from "@/components/ui/toast";
import { NETWORK_CONFIG } from "@/constants/networks";
import { MAX_REPLY_LENGTH, replyWindow, validateReply } from "@/lib/inbox/logic";
import type { DeliveryStatus, MessageItem } from "@/lib/inbox/types";
import { useNow } from "@/lib/use-now";
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
    <View className={`max-w-[85%] gap-1 ${outgoing ? "self-end items-end" : "self-start items-start"}`}>
      <View className={`rounded-[14px] px-3 py-2 ${outgoing ? "bg-buttons-primary-bg" : "bg-main-sections-2"}`}>
        <Text className="font-jakarta text-[14px] leading-[20px] text-text-primary">
          {message.body || (message.attachments.length > 0 ? "Pièce jointe" : "")}
        </Text>
      </View>
      <Text className="font-jakarta text-[10px] text-text-secondary">
        {format(parseISO(message.createdAt), "d MMM, HH:mm", { locale: fr })}
        {outgoing && message.sentByName ? ` · ${message.sentByName}` : ""}
        {outgoing ? ` · ${DELIVERY_LABEL[message.deliveryStatus]}` : ""}
      </Text>
      {message.deliveryStatus === "failed" ? (
        <Text className="max-w-[260px] text-right font-jakarta text-[11px] text-text-critical">
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
  const canWrite = useOrgStore((s) => s.canWrite);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<MessageItem>>(null);

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

  const send = useCallback(async () => {
    if (!id || !canSend) return;
    setSending(true);
    const result = await useInboxStore.getState().sendReply(id, draft);
    setSending(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setDraft("");
  }, [id, draft, canSend]);

  const toggleClosed = useCallback(async () => {
    if (!id) return;
    const result = await useInboxStore.getState().setStatus(id, closed ? "open" : "closed");
    if (!result.ok) showToast(result.error, "error");
  }, [id, closed]);

  if (!conversation) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background-primary px-8">
        <Text className="text-center font-jakarta text-body-1 text-text-secondary">Conversation introuvable.</Text>
        <Pressable className="mt-4" onPress={() => router.back()}>
          <Text className="font-jakarta text-[15px] font-semibold text-main-accent-pink">Retour</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const network = NETWORK_CONFIG[conversation.networkId];
  const expired = window.state === "expired";

  return (
    <SafeAreaView className="flex-1 bg-background-primary" edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="h-[60px] flex-row items-center gap-3 px-4">
          <Pressable className="h-8 w-8 items-center justify-center" hitSlop={8} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} className="text-icon-primary" />
          </Pressable>
          <View className="h-8 w-8 items-center justify-center rounded-[6px]" style={{ backgroundColor: network.bg }}>
            <Ionicons name={network.icon} size={16} color="#FFFFFF" />
          </View>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-jakarta text-[15px] font-semibold text-text-primary">
              {conversation.contactName}
            </Text>
            <Text numberOfLines={1} className="font-jakarta text-[11px] text-text-secondary">
              {conversation.accountName}
              {conversation.contactUsername ? ` · @${conversation.contactUsername}` : ""}
            </Text>
          </View>
          {canWrite ? (
            <Pressable hitSlop={8} onPress={toggleClosed}>
              <Text className="font-jakarta text-[13px] font-semibold text-main-accent-pink">{closed ? "Rouvrir" : "Fermer"}</Text>
            </Pressable>
          ) : null}
        </View>

        {window.state !== "none" ? (
          <View className={`mx-4 mb-2 rounded-[8px] px-3 py-2 ${expired ? "bg-[#3A1D1D]" : window.state === "urgent" ? "bg-[#3A2A10]" : "bg-main-sections-2"}`}>
            <Text
              className={`font-jakarta text-[12px] font-semibold ${expired ? "text-text-critical" : window.state === "urgent" ? "text-[#FFB020]" : "text-text-secondary"}`}
            >
              {expired
                ? "Fenêtre de réponse de 24 h dépassée : Meta n’autorise plus de réponse à cette conversation."
                : `${window.label} (24 h après le dernier message du client)`}
            </Text>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          className="flex-1 px-4"
          contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
          data={messages ?? []}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble message={item} />}
          ListEmptyComponent={
            messages === undefined ? null : (
              <Text className="mt-10 text-center font-jakarta text-body-1 text-text-secondary">Aucun message.</Text>
            )
          }
        />

        {canWrite ? (
          <View className="gap-1 border-t border-separator-primary px-4 pb-2 pt-2">
            {draft.length > MAX_REPLY_LENGTH - 200 ? (
              <Text className={`text-right font-jakarta text-[11px] ${draft.length > MAX_REPLY_LENGTH ? "text-text-critical" : "text-text-secondary"}`}>
                {draft.length}/{MAX_REPLY_LENGTH}
              </Text>
            ) : null}
            <View className="flex-row items-end gap-2">
              <TextInput
                className="max-h-[120px] min-h-[44px] flex-1 rounded-[12px] border border-input-stroke-default bg-input-bg px-3 py-[10px] font-jakarta text-body-1 text-text-primary"
                placeholder={expired ? "Réponse impossible : fenêtre dépassée" : "Votre réponse"}
                placeholderTextColor="#656464"
                value={draft}
                onChangeText={setDraft}
                editable={!expired}
                multiline
              />
              <Pressable
                accessibilityLabel="Envoyer"
                disabled={!canSend}
                onPress={send}
                className={`h-[44px] w-[44px] items-center justify-center rounded-[12px] ${canSend ? "bg-buttons-primary-bg" : "bg-buttons-disabled-bg"}`}
              >
                <Ionicons name="send" size={18} color={canSend ? "#FFFFFF" : "#9E9E9E"} />
              </Pressable>
            </View>
          </View>
        ) : (
          <Text className="px-4 pb-3 pt-2 text-center font-jakarta text-[12px] text-text-secondary">
            Votre rôle (lecteur) ne permet pas de répondre.
          </Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
