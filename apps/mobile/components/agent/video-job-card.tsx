import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { ActivityIndicator, AppState, Linking, Text, View } from "react-native";

import { MediaThumb } from "@/components/media/media-thumb";
import { OutlineButton, PrimaryButton } from "@/components/ui/kit";
import { fetchVideoJob, VIDEO_POLL_MS } from "@/lib/agent";
import type { AgentVideoJob } from "@/lib/agent-protocol";
import type { MediaItem } from "@/lib/media";
import { useAgentStore } from "@/store/agent-store";

/**
 * La vidéo qu'une réponse de l'agent a lancée. Elle prend plusieurs minutes : tant qu'elle est en cours, la carte l'interroge toutes les dix secondes
 * (ce qui la fait avancer côté serveur), puis propose de la voir et d'en faire une publication. Fermer l'écran n'interrompt rien : la vidéo se range
 * toute seule dans la médiathèque dès qu'une interrogation la trouve prête, et la conversation la retrouve à sa réouverture. Même carte que sur le web.
 */
export function VideoJobCard({ job, canWrite, onUse }: { job: AgentVideoJob; canWrite: boolean; onUse: (media: MediaItem) => void }) {
  const media = useAgentStore((s) => (job.mediaId ? s.media[job.mediaId] : undefined));
  const pending = job.status === "pending";

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const tick = async () => {
      if (stopped) return;
      if (AppState.currentState !== "active") return schedule(); // application en arrière-plan : on attend de la retrouver
      const response = await fetchVideoJob(job.id, controller.signal);
      if (stopped) return;
      if (response) {
        useAgentStore.getState().applyJob(response.job);
        if (response.job.status !== "pending") return;
      }
      schedule();
    };
    const schedule = () => {
      timer = setTimeout(() => void tick(), VIDEO_POLL_MS);
    };

    timer = setTimeout(() => void tick(), 4_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || stopped) return;
      clearTimeout(timer);
      void tick();
    });
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      sub.remove();
    };
  }, [job.id, pending]);

  const ready = job.status === "completed" && !!job.mediaId;
  const removed = job.status === "completed" && !job.mediaId;
  const vertical = job.orientation === "vertical";
  const title = pending ? "Vidéo en cours de génération…" : removed ? "Cette vidéo a été supprimée de la médiathèque." : ready ? "Vidéo prête" : "La vidéo n’a pas pu être générée.";

  return (
    <View accessibilityLabel="Génération de vidéo" className="mt-3 max-w-[420px] gap-2.5 rounded-[20px] border border-line bg-card p-3.5">
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          {pending ? (
            <ActivityIndicator size="small" color="#6B6A64" />
          ) : (
            <Ionicons name={ready ? "checkmark-circle" : "alert-circle"} size={18} color={ready ? "#2F4A00" : "#B3261E"} />
          )}
          <Text accessibilityRole="header" numberOfLines={2} className="min-w-0 flex-1 font-jakarta text-[13.5px] font-semibold text-ink">{title}</Text>
        </View>
        <Text className="rounded-full bg-chip-bg px-2 py-0.5 font-jakarta text-[11px] text-ink-soft">{vertical ? "Verticale 9:16" : "Horizontale 16:9"}</Text>
      </View>

      {pending ? <Text className="font-jakarta text-[13px] leading-[19px] text-ink-soft">Cela prend quelques minutes. Vous pouvez laisser l’application ouverte ou revenir plus tard : la vidéo sera dans votre médiathèque.</Text> : null}
      {job.status === "failed" && job.error ? <Text className="font-jakarta text-[13px] leading-[19px] text-ink-soft">{`Raison : ${job.error}`}</Text> : null}

      {ready && media ? (
        <View className="items-center">
          <View style={{ width: vertical ? 150 : 260, height: vertical ? 266 : 146, borderRadius: 14, overflow: "hidden", backgroundColor: "#1B1B1A", alignItems: "center", justifyContent: "center" }}>
            {media.thumbUrl ? <MediaThumb uri={media.thumbUrl} kind="video" size={vertical ? 266 : 260} radius={0} /> : <Ionicons name="videocam" size={34} color="#9A9890" />}
          </View>
        </View>
      ) : null}

      {job.prompt ? <Text numberOfLines={2} className="font-jakarta text-[12px] leading-[17px] text-ink-muted">{job.prompt}</Text> : null}

      {ready && media?.url ? <OutlineButton label="Voir la vidéo" onPress={() => void Linking.openURL(media.url!)} /> : null}
      {ready && media && canWrite ? <PrimaryButton label="Préparer une publication avec cette vidéo" icon="sparkles" onPress={() => onUse(media)} /> : null}
    </View>
  );
}
