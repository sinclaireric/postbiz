import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";

import { MediaThumb } from "@/components/media/media-thumb";
import { haptic } from "@/lib/haptics";
import { IconCircle, Sheet } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { listMedia, pickAndUpload, type MediaItem } from "@/lib/media";
import { MAX_MEDIA_PER_POST } from "@/lib/media-rules";
import { useOrgStore } from "@/store/org-store";

const GAP = 8;
const COLUMNS = 3;

/** Choix des médias d'une publication : la médiathèque, et un bouton pour en importer depuis le téléphone. */
export function MediaPickerSheet({
  visible,
  onClose,
  initial,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  /** Médias déjà joints (ils restent cochés, dans leur ordre). */
  initial: MediaItem[];
  onConfirm: (items: MediaItem[]) => void;
}) {
  const { width } = useWindowDimensions();
  const orgId = useOrgStore((s) => s.current?.id);
  const canWrite = useOrgStore((s) => s.canWrite);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [picked, setPicked] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !orgId) return;
    setPicked(initial);
    setLibrary(null);
    void listMedia(orgId).then((r) => setLibrary(r.items), () => setLibrary([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, orgId]);

  const size = (width - 32 - GAP * (COLUMNS - 1)) / COLUMNS;

  const toggle = (item: MediaItem) => {
    haptic.select();
    setPicked((cur) => {
      if (cur.some((m) => m.id === item.id)) return cur.filter((m) => m.id !== item.id);
      if (cur.length >= MAX_MEDIA_PER_POST) {
        showToast(`${MAX_MEDIA_PER_POST} médias au maximum par publication.`, "info");
        return cur;
      }
      return [...cur, item];
    });
  };

  const importFromPhone = async () => {
    setBusy(true);
    const result = await pickAndUpload();
    setBusy(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    const added = result.items ?? [];
    if (added.length === 0) return;
    setLibrary((cur) => [...added, ...(cur ?? [])]);
    setPicked((cur) => [...cur, ...added.filter((a) => !cur.some((m) => m.id === a.id))].slice(0, MAX_MEDIA_PER_POST));
  };

  const selectedIndex = (id: string) => picked.findIndex((m) => m.id === id);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Médias"
      right={<IconCircle icon="checkmark" label="Valider" active onPress={() => onConfirm(picked)} />}
    >
      <Text className="mb-3 font-jakarta text-[12.5px] text-ink-soft">
        {picked.length === 0 ? "Touchez des médias pour les joindre." : `${picked.length} média${picked.length > 1 ? "s" : ""} sélectionné${picked.length > 1 ? "s" : ""}.`}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingBottom: 12 }}>
        {canWrite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Importer depuis le téléphone"
            disabled={busy}
            onPress={importFromPhone}
            style={{ width: size, height: size, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#B9B7AE", alignItems: "center", justifyContent: "center", gap: 4 }}
          >
            {busy ? <ActivityIndicator color="#2F4A00" /> : <Ionicons name="cloud-upload-outline" size={26} color="#2F4A00" />}
            <Text className="px-1 text-center font-jakarta text-[11px] font-semibold text-brand-ink">{busy ? "Envoi…" : "Importer"}</Text>
          </Pressable>
        ) : null}
        {library === null ? (
          <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color="#2F4A00" />
          </View>
        ) : (
          library.map((m) => {
            const idx = selectedIndex(m.id);
            const on = idx >= 0;
            return (
              <Pressable key={m.id} onPress={() => toggle(m)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={m.name}>
                <MediaThumb uri={m.thumbUrl ?? (m.kind === "image" ? m.url : null)} kind={m.kind} size={size} />
                <View
                  style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? "#C6F432" : "rgba(255,255,255,0.85)", borderWidth: on ? 0 : 1.5, borderColor: "#B9B7AE" }}
                >
                  {on ? <Text style={{ fontSize: 12, fontWeight: "700", color: "#141414" }}>{idx + 1}</Text> : null}
                </View>
              </Pressable>
            );
          })
        )}
      </View>
      {library !== null && library.length === 0 ? <Text className="pb-4 text-center font-jakarta text-[12.5px] text-ink-soft">Votre médiathèque est vide : importez des photos ou des vidéos.</Text> : null}
    </Sheet>
  );
}
