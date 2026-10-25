import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { ConfirmSheet } from "@/components/ui/kit";
import { DEMO } from "@/lib/demo";
import { haptic } from "@/lib/haptics";
import type { ConversationSummary, MessageItem } from "@/lib/inbox/types";
import { NOT_CONFIGURED, requestSuggestion, settleSuggestion, suggestConfigured, suggestErrorMessage } from "@/lib/suggest";
import { demoSuggestion } from "@/lib/suggest-demo";
import type { SuggestResult, Suggestion } from "@/lib/suggest-protocol";

// « Suggérer une réponse » dans une conversation de l'inbox, comme sur le web (apps/web/.../inbox/reply-form.tsx) : l'IA du serveur prépare un brouillon d'après la base de
// connaissance, il est mis dans le champ de réponse, et une personne le relit, le corrige et l'envoie. Rien ne part seul. À l'envoi, on note si le brouillon est parti tel quel
// ou modifié (`settle`). En démonstration (EXPO_PUBLIC_DEMO=1), le brouillon est simulé : aucune requête ne part.

/** Durée de la « rédaction » simulée en démonstration, pour qu'on voie l'état de chargement. */
const DEMO_DELAY_MS = 900;

type SuggestState = { status: "idle" } | { status: "loading" } | { status: "done"; suggestion: Suggestion } | { status: "error"; message: string };
const IDLE: SuggestState = { status: "idle" };

/** Où va la demande : au serveur du web, ou à la suggestion simulée en démonstration. `null` : l'adresse du serveur n'est pas renseignée dans l'application. */
async function ask(conversation: ConversationSummary, messages: MessageItem[], signal: AbortSignal): Promise<SuggestResult | null> {
  if (DEMO) {
    await new Promise((resolve) => setTimeout(resolve, DEMO_DELAY_MS));
    return demoSuggestion({ kind: conversation.kind, contactName: conversation.contactName, replyWindowExpiresAt: conversation.replyWindowExpiresAt, messages });
  }
  return suggestConfigured() ? requestSuggestion(conversation.id, signal) : null;
}

export function useReplySuggestion({ conversation, messages, draft, setDraft }: {
  conversation: ConversationSummary | undefined;
  messages: MessageItem[] | undefined;
  /** Le texte du champ de réponse, et de quoi le remplacer. */
  draft: string;
  setDraft: (text: string) => void;
}) {
  const conversationId = conversation?.id;
  const [state, setState] = useState<SuggestState>(IDLE);
  // Un brouillon reçu alors que le champ contient déjà un texte attend que la personne dise si elle veut le remplacer (comme le « confirm » du web).
  const [offered, setOffered] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  // Ce que la demande lit quand la réponse arrive, plusieurs secondes après l'appui : le texte écrit entre-temps compte.
  const latest = useRef({ conversation, messages, draft });
  useEffect(() => {
    latest.current = { conversation, messages, draft };
  });

  // Un autre fil, ou la sortie de l'écran : la demande en cours est abandonnée et sa réponse ne sera pas lue.
  useEffect(() => {
    setState(IDLE);
    setOffered(null);
    return () => pending.current?.abort();
  }, [conversationId]);

  const request = useCallback(async () => {
    const { conversation: c, messages: m } = latest.current;
    if (!c || state.status === "loading") return;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    haptic.tap();
    setState({ status: "loading" });
    // `ask` ne lève jamais en pratique ; si cela arrivait, mieux vaut une erreur affichée qu'un chargement qui ne finit pas (bouton bloqué sur « Rédaction… »).
    const result = await ask(c, m ?? [], controller.signal).catch((): SuggestResult => ({ ok: false, error: "failed" }));
    if (controller.signal.aborted) return;
    if (!result || !result.ok) {
      haptic.warning();
      setState({ status: "error", message: result ? suggestErrorMessage(result.error) : NOT_CONFIGURED });
      return;
    }
    const { suggestion } = result;
    if (suggestion.reply) {
      if (latest.current.draft.trim()) setOffered(suggestion.reply);
      else setDraft(suggestion.reply);
    }
    haptic.success();
    setState({ status: "done", suggestion });
  }, [setDraft, state.status]);

  /** À appeler quand la réponse vient de partir : note si elle est partie telle quelle ou modifiée, puis repart de zéro. N'attend rien : la mesure ne gêne jamais l'envoi. */
  const settle = useCallback(
    (sent: string) => {
      pending.current?.abort();
      if (state.status === "done" && !DEMO) void settleSuggestion(state.suggestion, sent);
      setState(IDLE);
      setOffered(null);
    },
    [state],
  );

  const replaceDraft = useCallback(() => {
    if (offered !== null) setDraft(offered);
    setOffered(null);
  }, [offered, setDraft]);
  const keepDraft = useCallback(() => setOffered(null), []);

  return { state, offered, request, settle, replaceDraft, keepDraft };
}

export type ReplySuggestion = ReturnType<typeof useReplySuggestion>;

/** Le bouton, au-dessus du champ de réponse. `disabled` : la fenêtre de réponse est fermée, ou un envoi est en cours. */
export function SuggestButton({ suggest, disabled }: { suggest: ReplySuggestion; disabled: boolean }) {
  const loading = suggest.state.status === "loading";
  const off = disabled && !loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Suggérer une réponse"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      hitSlop={6}
      onPress={() => void suggest.request()}
      className={`h-[36px] flex-row items-center gap-1.5 self-start rounded-full px-3.5 ${off ? "bg-chip-bg" : "bg-brand-soft"}`}
    >
      {loading ? <ActivityIndicator size="small" color="#2F4A00" /> : <Ionicons name="sparkles" size={15} color={off ? "#9A9890" : "#2F4A00"} />}
      <Text className={`font-jakarta text-[12.5px] font-semibold ${off ? "text-ink-muted" : "text-brand-ink"}`}>{loading ? "Rédaction…" : "Suggérer une réponse"}</Text>
    </Pressable>
  );
}

/** Sous le champ : ce qu'il faut savoir du brouillon (à relire, sujet sensible, sans source), les fiches consultées ou l'erreur ; et la confirmation avant de remplacer un texte déjà écrit. */
export function SuggestFeedback({ suggest }: { suggest: ReplySuggestion }) {
  const { state } = suggest;
  const s = state.status === "done" ? state.suggestion : null;
  return (
    <>
      <View accessibilityLiveRegion="polite" className="gap-0.5 px-2">
        {s?.reply ? <Text className="font-jakarta text-[11.5px] font-medium leading-[15px] text-brand-ink">Suggestion de l’IA, à relire avant d’envoyer : corrigez-la si besoin.</Text> : null}
        {s?.needsHuman ? <Text className="font-jakarta text-[11.5px] font-medium leading-[15px] text-[#8A5A00]">Sujet sensible : à traiter par une personne de l’équipe.</Text> : null}
        {s && !s.grounded ? <Text className="font-jakarta text-[11.5px] font-medium leading-[15px] text-[#8A5A00]">Rien dans votre base ne répond à cette question : complétez la réponse vous-même.</Text> : null}
        {s && s.sources.length > 0 ? <Text className="font-jakarta text-[11.5px] leading-[15px] text-ink-soft">Sources consultées : {s.sources.join(", ")}</Text> : null}
        {s && DEMO ? <Text className="font-jakarta text-[11.5px] leading-[15px] text-ink-muted">Mode démo : suggestion simulée, aucune IA n’est appelée.</Text> : null}
        {state.status === "error" ? (
          <Text accessibilityRole="alert" className="font-jakarta text-[12px] font-medium leading-[16px] text-text-critical">
            {state.message}
          </Text>
        ) : null}
      </View>
      <ConfirmSheet
        visible={suggest.offered !== null}
        title="Remplacer votre texte ?"
        message="Remplacer votre texte par la suggestion ?"
        confirmLabel="Remplacer"
        cancelLabel="Garder mon texte"
        onConfirm={suggest.replaceDraft}
        onCancel={suggest.keepDraft}
      />
    </>
  );
}
