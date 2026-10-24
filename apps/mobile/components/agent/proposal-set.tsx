import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { MediaPickerSheet } from "@/components/media/media-picker-sheet";
import { MediaThumb } from "@/components/media/media-thumb";
import { PostPreview } from "@/components/post-preview/post-preview";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { DateTimeSheet } from "@/components/ui/datetime-sheet";
import { OutlineButton, PrimaryButton } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { markProposals, type ProposalUpdate } from "@/lib/agent";
import type { AgentMessage, AgentProposal } from "@/lib/agent-protocol";
import { FIRST_COMMENT_LIMITS, nextSlot, proposalProblems, supportsFirstComment, TEXT_LIMITS } from "@/lib/agent-rules";
import { DEMO } from "@/lib/demo";
import type { MediaItem } from "@/lib/media";
import { validateMedia } from "@/lib/media-rules";
import { normalizeProvider, formatNetworkLabel } from "@/lib/networks";
import { countLength } from "@/lib/text-length";
import { useAgentStore } from "@/store/agent-store";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";
import { usePostsStore } from "@/store/posts-store";
import type { Channel } from "@/types";
import { capFirst } from "@/utils/text";

/** Ce que l'utilisateur a modifié d'une publication avant de l'enregistrer. */
type Edit = { text: string; firstComment: string; mediaIds: string[]; date: Date };

const initialEdit = (p: AgentProposal): Edit => ({ text: p.text, firstComment: p.firstComment ?? "", mediaIds: p.mediaIds, date: p.publishAt ? new Date(p.publishAt) : nextSlot(new Date()) });

/** Le canal de la publication ; s'il n'existe plus, un canal de remplacement pour pouvoir quand même l'afficher. */
const channelOf = (p: AgentProposal, channels: Channel[]): Channel & { gone: boolean } => {
  const found = channels.find((c) => c.id === p.integrationId);
  return found ? { ...found, gone: false } : { id: p.integrationId, name: p.accountName, network: normalizeProvider(p.networkId), avatar: "", status: "disabled", gone: true };
};

const whenLabel = (d: Date) => capFirst(format(d, "EEEE d MMMM 'à' HH:mm", { locale: fr }));

function SavedCard({ proposal, channel, media }: { proposal: AgentProposal; channel: Channel; media: Record<string, MediaItem> }) {
  const names = proposal.mediaIds.map((id) => media[id]?.name).filter(Boolean).join(", ");
  return (
    <View className="gap-2 rounded-[22px] border border-line bg-card p-4">
      <View className="flex-row items-center gap-3">
        <ChannelAvatar avatar={channel.avatar} network={channel.network} name={channel.name} size={34} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-jakarta text-[14px] font-semibold text-ink">{channel.name}</Text>
          <Text className="font-jakarta text-[12px] text-ink-soft">{formatNetworkLabel(channel.network)}</Text>
        </View>
        <View className="rounded-full bg-chip-bg px-3 py-1">
          <Text className="font-jakarta text-[12px] font-semibold text-ink">{proposal.status === "scheduled" ? "Programmée" : "Brouillon"}</Text>
        </View>
      </View>
      <Text numberOfLines={4} className="font-jakarta text-[13.5px] leading-[19px] text-ink-soft">{proposal.text}</Text>
      {names ? <Text className="font-jakarta text-[11.5px] text-ink-muted">{names}</Text> : null}
      <Text className="font-jakarta text-[12px] text-ink-muted">
        {proposal.status === "scheduled" && proposal.publishAt ? `Programmée pour le ${whenLabel(new Date(proposal.publishAt))}` : "Enregistrée en brouillon dans le calendrier."}
      </Text>
    </View>
  );
}

function PendingCard({ proposal, channel, media, edit, onEdit, busy, errors, canWrite, onSave }: {
  proposal: AgentProposal;
  channel: Channel & { gone: boolean };
  media: Record<string, MediaItem>;
  edit: Edit;
  onEdit: (patch: Partial<Edit>) => void;
  busy: boolean;
  errors: string[];
  canWrite: boolean;
  onSave: (mode: "draft" | "schedule") => void;
}) {
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [dateOpen, setDateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(Boolean(edit.firstComment));

  const attached = edit.mediaIds.flatMap((id) => (media[id] ? [media[id]!] : []));
  const problems = (mode: "draft" | "schedule") =>
    proposalProblems({
      network: channel.network, label: formatNetworkLabel(channel.network), text: edit.text, firstComment: edit.firstComment, mediaCount: attached.length,
      mediaProblems: validateMedia(channel.network, formatNetworkLabel(channel.network), attached.map((m) => ({ kind: m.kind, name: m.name, width: m.width, height: m.height }))),
      mode, publishAt: edit.date,
    });
  const draftProblems = problems("draft");
  const scheduleProblems = problems("schedule");
  const shown = [...new Set([...errors, ...scheduleProblems])];
  const disabled = busy || !canWrite || channel.gone || channel.status !== "active";

  const key = channel.network === "linkedin-page" ? "linkedin_page" : channel.network;
  const max = TEXT_LIMITS[key] ?? Infinity;
  const length = countLength(key, edit.text.trim());
  const canComment = supportsFirstComment(key);

  return (
    <View className="gap-3 rounded-[26px] border border-line bg-card p-4">
      <View className="flex-row items-center gap-3">
        <ChannelAvatar avatar={channel.avatar} network={channel.network} name={channel.name} size={36} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-jakarta text-[14.5px] font-semibold text-ink">{channel.name}</Text>
          <Text className="font-jakarta text-[12px] text-ink-soft">{formatNetworkLabel(channel.network)}</Text>
        </View>
        <View className="flex-row rounded-full bg-chip-bg p-0.5">
          {(["preview", "edit"] as const).map((id) => (
            <Pressable key={id} accessibilityRole="button" onPress={() => setTab(id)} className={`rounded-full px-3 py-1.5 ${tab === id ? "bg-card" : ""}`}>
              <Text className={`font-jakarta text-[12.5px] font-semibold ${tab === id ? "text-ink" : "text-ink-soft"}`}>{id === "preview" ? "Aperçu" : "Modifier"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === "preview" ? (
        <PostPreview
          network={channel.network} name={channel.name} username={channel.username} avatar={channel.avatar || undefined} thread={[edit.text]} date={edit.date.toISOString()}
          media={attached.map((m) => ({ kind: m.kind, uri: m.thumbUrl ?? m.url }))}
        />
      ) : (
        <View className="gap-3">
          <View>
            <TextInput
              className="min-h-[110px] rounded-[18px] border border-line bg-canvas p-3 font-jakarta text-[14.5px] leading-[20.5px] text-ink"
              style={{ textAlignVertical: "top" }}
              value={edit.text} onChangeText={(t) => onEdit({ text: t })} multiline editable={!disabled} accessibilityLabel="Texte de la publication"
            />
            <Text className={`mt-1 text-right font-jakarta text-[11px] ${length > max ? "text-text-critical" : "text-ink-muted"}`}>
              {length.toLocaleString("fr-FR")}{Number.isFinite(max) ? ` / ${max.toLocaleString("fr-FR")}` : ""} caractères
            </Text>
          </View>

          {canComment ? (
            commentOpen ? (
              <View>
                <TextInput
                  className="min-h-[60px] rounded-[18px] border border-line bg-canvas p-3 font-jakarta text-[14px] leading-[20px] text-ink"
                  style={{ textAlignVertical: "top" }} placeholder="Premier commentaire, publié sous la publication"
                  value={edit.firstComment} onChangeText={(t) => onEdit({ firstComment: t })} multiline editable={!disabled}
                />
                <Text className="mt-1 text-right font-jakarta text-[11px] text-ink-muted">
                  {countLength(key, edit.firstComment.trim()).toLocaleString("fr-FR")} / {FIRST_COMMENT_LIMITS[key]!.toLocaleString("fr-FR")} caractères
                </Text>
              </View>
            ) : (
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setCommentOpen(true)}>
                <Text className="font-jakarta text-[12.5px] font-semibold text-ink-soft underline">Ajouter un premier commentaire</Text>
              </Pressable>
            )
          ) : null}

          <View className="flex-row flex-wrap items-center gap-2">
            {attached.map((m) => (
              <View key={m.id}>
                <MediaThumb uri={m.thumbUrl ?? m.url} kind={m.kind} size={56} />
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`Retirer ${m.name}`} disabled={disabled} onPress={() => onEdit({ mediaIds: edit.mediaIds.filter((x) => x !== m.id) })}
                  className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-ink"
                >
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setPickerOpen(true)} className="h-[56px] w-[56px] items-center justify-center rounded-[12px] border border-dashed border-line">
              <Ionicons name="image-outline" size={20} color="#6B6A64" />
            </Pressable>
          </View>
        </View>
      )}

      <Pressable disabled={disabled} onPress={() => setDateOpen(true)} className="flex-row items-center gap-3 rounded-[18px] border border-line bg-canvas px-4 py-3">
        <Ionicons name="calendar-outline" size={20} color="#141414" />
        <View className="flex-1">
          <Text className="font-jakarta text-[11px] text-ink-soft">Date de publication</Text>
          <Text className="font-jakarta text-[14px] font-semibold text-ink">{whenLabel(edit.date)}</Text>
        </View>
        <Text className="font-jakarta text-[12.5px] font-semibold text-brand-ink">Modifier</Text>
      </Pressable>

      {shown.length > 0 ? (
        <View className="gap-1">
          {shown.map((m) => <Text key={m} className="font-jakarta text-[12px] text-text-critical">{m}</Text>)}
        </View>
      ) : null}
      {channel.gone || channel.status !== "active" ? <Text className="font-jakarta text-[12px] text-text-critical">Ce canal n’est plus disponible : reconnectez-le ou choisissez-en un autre.</Text> : null}

      <OutlineButton label="Enregistrer en brouillon" onPress={() => onSave("draft")} disabled={disabled || draftProblems.length > 0 || (!edit.text.trim() && attached.length === 0)} />
      <PrimaryButton label="Programmer" onPress={() => onSave("schedule")} disabled={disabled || scheduleProblems.length > 0} loading={busy} />

      <DateTimeSheet visible={dateOpen} onClose={() => setDateOpen(false)} value={edit.date} onSave={(d) => { onEdit({ date: d }); setDateOpen(false); }} />
      <MediaPickerSheet
        visible={pickerOpen} onClose={() => setPickerOpen(false)} initial={attached}
        onConfirm={(items) => { useAgentStore.getState().addMedia(items); onEdit({ mediaIds: items.map((m) => m.id) }); setPickerOpen(false); }}
      />
    </View>
  );
}

/**
 * Les publications qu'un message de l'agent propose : une carte par canal, avec aperçu et modification, à enregistrer en brouillon ou à programmer une par une,
 * ou toutes d'un coup. Rien n'est écrit dans le calendrier avant une pression sur un bouton ; l'enregistrement passe par les mêmes règles que sur le web
 * (longueurs, médias exigés, date dans le futur, premier commentaire) et par la session de l'utilisateur.
 */
export function ProposalSet({ message, canWrite }: { message: AgentMessage; canWrite: boolean }) {
  const channels = useChannelsStore((s) => s.channels);
  const media = useAgentStore((s) => s.media);
  const org = useOrgStore((s) => s.current);
  const [edits, setEdits] = useState<Record<string, Edit>>(() => Object.fromEntries(message.proposals.map((p) => [p.id, initialEdit(p)])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Les médias ajoutés ou retirés dans les cartes ne sont pas dans le message : on repart de lui seulement si de nouvelles publications arrivent.
  useEffect(() => {
    setEdits((cur) => Object.fromEntries(message.proposals.map((p) => [p.id, cur[p.id] ?? initialEdit(p)])));
  }, [message.proposals]);

  const pending = useMemo(() => message.proposals.filter((p) => p.status === "pending"), [message.proposals]);

  const save = async (mode: "draft" | "schedule", ids: string[]) => {
    if (!org) return;
    setBusy(true);
    setErrors({});
    const failures: Record<string, string[]> = {};
    const saved: ProposalUpdate[] = [];

    for (const id of ids) {
      const p = message.proposals.find((x) => x.id === id);
      const e = edits[id];
      if (!p || !e) continue;
      const channel = channelOf(p, channels);
      const items = e.mediaIds.flatMap((mid) => (media[mid] ? [media[mid]!] : []));
      const label = formatNetworkLabel(channel.network);
      const problems = proposalProblems({
        network: channel.network, label, text: e.text, firstComment: e.firstComment, mediaCount: items.length,
        mediaProblems: validateMedia(channel.network, label, items.map((m) => ({ kind: m.kind, name: m.name, width: m.width, height: m.height }))), mode, publishAt: e.date,
      });
      if (problems.length > 0 || channel.gone || channel.status !== "active") {
        failures[id] = problems.length > 0 ? problems : ["Ce canal n’est plus disponible."];
        continue;
      }
      const key = channel.network === "linkedin-page" ? "linkedin_page" : channel.network;
      // En démonstration, rien n'est écrit dans un calendrier : la carte passe simplement à l'état enregistré.
      const result = DEMO
        ? { ok: true as const }
        : await usePostsStore.getState().savePosts({
            action: mode === "draft" ? "draft" : "calendar",
            publishAt: e.date,
            media: items.map((m) => ({ id: m.id, kind: m.kind, alt: m.alt })),
            items: [{ channelId: p.integrationId, thread: [e.text.trim()], firstComment: supportsFirstComment(key) ? e.firstComment.trim() || null : null }],
          });
      if (!result.ok) {
        failures[id] = [result.error];
        continue;
      }
      saved.push({ id, status: mode === "draft" ? "draft" : "scheduled", text: e.text.trim(), firstComment: supportsFirstComment(key) ? e.firstComment.trim() || null : null, mediaIds: e.mediaIds, publishAt: e.date.toISOString() });
    }

    if (saved.length > 0) {
      useAgentStore.getState().applySaved(message.id, saved);
      if (!DEMO && !(await markProposals(org.id, message.id, saved))) showToast("Enregistré dans le calendrier, mais l’état n’a pas pu être mis à jour dans la conversation.", "error");
      else showToast(DEMO ? "Mode démo : rien n’est envoyé au calendrier." : mode === "draft" ? "Brouillons enregistrés" : "Publications programmées", "success");
    }
    setErrors(failures);
    setBusy(false);
  };

  // « Tout » n'est proposé que si chaque carte en attente est valide, comme le bouton d'une carte.
  const allValid = pending.every((p) => {
    const e = edits[p.id];
    if (!e) return false;
    const channel = channelOf(p, channels);
    const items = e.mediaIds.flatMap((mid) => (media[mid] ? [media[mid]!] : []));
    const label = formatNetworkLabel(channel.network);
    return !channel.gone && channel.status === "active" && proposalProblems({
      network: channel.network, label, text: e.text, firstComment: e.firstComment, mediaCount: items.length,
      mediaProblems: validateMedia(channel.network, label, items.map((m) => ({ kind: m.kind, name: m.name, width: m.width, height: m.height }))), mode: "schedule", publishAt: e.date,
    }).length === 0;
  });

  return (
    <View className="mt-3 gap-3">
      {message.proposals.map((p) => {
        const channel = channelOf(p, channels);
        const edit = edits[p.id];
        return p.status === "pending" && edit ? (
          <PendingCard
            key={p.id} proposal={p} channel={channel} media={media} edit={edit} busy={busy} errors={errors[p.id] ?? []} canWrite={canWrite}
            onEdit={(patch) => setEdits((cur) => ({ ...cur, [p.id]: { ...cur[p.id]!, ...patch } }))} onSave={(mode) => void save(mode, [p.id])}
          />
        ) : (
          <SavedCard key={p.id} proposal={p} channel={channel} media={media} />
        );
      })}
      {pending.length > 1 && canWrite ? (
        <View className="gap-2">
          <OutlineButton label={`Tout enregistrer en brouillon (${pending.length})`} onPress={() => void save("draft", pending.map((p) => p.id))} disabled={busy} />
          <PrimaryButton label={`Tout programmer (${pending.length})`} onPress={() => void save("schedule", pending.map((p) => p.id))} disabled={busy || !allValid} loading={busy} />
        </View>
      ) : null}
    </View>
  );
}
