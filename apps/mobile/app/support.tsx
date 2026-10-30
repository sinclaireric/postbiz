import { Ionicons } from "@expo/vector-icons";
import { format, isSameDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Appear, PageHeader } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { haptic } from "@/lib/haptics";
import { SUPPORT_USER_MAX, validateSupportBody, cleanSupportBody, type SupportMessage } from "@/lib/support-logic";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";
import { useSupportStore } from "@/store/support-store";

const POLL_MS = 15_000;

function Bubble({ message }: { message: SupportMessage }) {
  const mine = message.author === "user";
  return (
    <View className={`max-w-[85%] gap-1 ${mine ? "items-end self-end" : "items-start self-start"}`}>
      <Text className="px-1 font-jakarta text-[10.5px] font-semibold text-ink-soft">{mine ? "Vous" : "Équipe Postbiz"}</Text>
      <View className={`rounded-[20px] px-4 py-3 ${mine ? "rounded-br-[6px] bg-brand" : "rounded-bl-[6px] border border-line bg-card"}`}>
        {/* Texte brut : jamais interprété, aucun lien cliquable. */}
        <Text className="font-jakarta text-[14.5px] leading-[19.5px] text-ink">{message.body}</Text>
      </View>
      <Text className="font-jakarta text-[10px] text-ink-muted">{format(parseISO(message.createdAt), "HH:mm", { locale: fr })}</Text>
    </View>
  );
}

/** Écrire au support de Postbiz : le même fil que sur le site (tables `support_conversations` et `support_messages`, sous RLS). */
export default function SupportScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const orgId = useOrgStore((s) => s.current?.id ?? null);
  const messages = useSupportStore((s) => s.messages);
  const loaded = useSupportStore((s) => s.loaded);
  const unread = useSupportStore((s) => s.unread);
  const status = useSupportStore((s) => s.status);
  const loadFailed = useSupportStore((s) => s.error);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  const refresh = useCallback(() => {
    if (userId) void useSupportStore.getState().load(userId);
  }, [userId]);

  // Chargement à l'ouverture, au retour au premier plan, et toutes les 15 s tant que l'écran est ouvert (Realtime prévient aussi, voir lib/use-realtime.ts).
  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (AppState.currentState === "active") refresh(); }, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh]);

  // Des réponses non lues sont sous les yeux de la personne : elles sont lues.
  useEffect(() => {
    if (unread > 0) void useSupportStore.getState().markRead();
  }, [unread]);

  useEffect(() => {
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const clean = cleanSupportBody(draft);
  const tooLong = validateSupportBody(clean) === "message_too_long";
  const canSend = !sending && clean.length > 0 && !tooLong;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const result = await useSupportStore.getState().send(draft, orgId);
    setSending(false);
    if (!result.ok) return showToast(result.error, "error");
    haptic.success();
    setDraft("");
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <PageHeader title="Support" onBack={() => router.back()} />
        {loadFailed ? (
          <Text className="mx-4 mb-2 rounded-[14px] bg-[#FFF1CC] px-4 py-2 font-jakarta text-[12px] text-[#8A5A00]">Impossible d’actualiser la conversation. Nouvel essai en cours.</Text>
        ) : null}
        <FlatList
          ref={listRef}
          className="flex-1 px-4"
          contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => {
            const previous = messages[index - 1];
            const newDay = !previous || !isSameDay(parseISO(previous.createdAt), parseISO(item.createdAt));
            return (
              <Appear from="up">
                {newDay ? <Text className="mb-3 text-center font-jakarta text-[11px] font-semibold text-ink-muted">{format(parseISO(item.createdAt), "EEEE d MMMM", { locale: fr })}</Text> : null}
                <Bubble message={item} />
              </Appear>
            );
          }}
          ListEmptyComponent={
            loaded ? (
              <Text className="mt-10 px-6 text-center font-jakarta text-[13.5px] leading-[19px] text-ink-soft">
                Une question, un problème ? Écrivez-nous ici : nous vous répondons dans cette conversation et vous êtes prévenu par une notification.
              </Text>
            ) : undefined
          }
        />
        {status === "resolved" && messages.length > 0 ? (
          <Text className="mx-4 mb-1 text-center font-jakarta text-[12px] text-ink-soft">Conversation marquée comme résolue. Un nouveau message la rouvre.</Text>
        ) : null}
        <View className="gap-1 px-4 pb-2 pt-2">
          {draft.length > SUPPORT_USER_MAX - 200 ? (
            <Text className={`text-right font-jakarta text-[10px] ${tooLong ? "text-text-critical" : "text-ink-muted"}`}>
              {[...clean].length}/{SUPPORT_USER_MAX}
            </Text>
          ) : null}
          <View className="flex-row items-end gap-2">
            <TextInput
              className="max-h-[130px] min-h-[52px] flex-1 rounded-[26px] border border-line bg-card px-5 py-[14px] font-jakarta text-[14.5px] text-ink"
              placeholder="Votre message au support"
              placeholderTextColor="#9A9890"
              value={draft}
              onChangeText={setDraft}
              multiline
              accessibilityLabel="Votre message au support"
            />
            <Pressable accessibilityLabel="Envoyer" disabled={!canSend} onPress={send} className={`h-[52px] w-[52px] items-center justify-center rounded-full ${canSend ? "bg-brand" : "bg-chip-bg"}`}>
              <Ionicons name="arrow-up" size={24} color={canSend ? "#141414" : "#9A9890"} />
            </Pressable>
          </View>
          <Text className="px-2 pt-1 text-center font-jakarta text-[10.5px] text-ink-muted">Conversation privée : seuls vous et l’équipe Postbiz la lisez.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
