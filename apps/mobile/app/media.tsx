import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MediaThumb } from "@/components/media/media-thumb";
import { haptic } from "@/lib/haptics";
import Reanimated, { ZoomIn } from "react-native-reanimated";

import { ConfirmSheet, EmptyState, PageHeader } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { deleteMedia, listMedia, pickAndUpload, type MediaItem } from "@/lib/media";
import { useOrgStore } from "@/store/org-store";

const GAP = 8;
const COLUMNS = 3;

export default function MediaScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const orgId = useOrgStore((s) => s.current?.id);
  const canWrite = useOrgStore((s) => s.canWrite);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);

  const size = (width - 32 - GAP * (COLUMNS - 1)) / COLUMNS;

  const load = useCallback(async () => {
    if (orgId) setItems((await listMedia(orgId)).items);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    setBusy(true);
    const result = await pickAndUpload((done, total) => setProgress({ done, total }));
    setBusy(false);
    setProgress(null);
    if (!result.ok) showToast(result.error, "error");
    else if (result.items?.length) showToast(`${result.items.length} média${result.items.length > 1 ? "s" : ""} ajouté${result.items.length > 1 ? "s" : ""}`, "success");
    await load();
  };

  const remove = async () => {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    const result = await deleteMedia([target]);
    if (!result.ok) showToast(result.error, "error");
    else if (result.blocked) showToast("Ce média est utilisé par une publication en attente : il est conservé.", "info");
    else showToast("Média supprimé", "success");
    await load();
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />
      <PageHeader
        title="Médias"
        onBack={() => router.back()}
        right={
          canWrite ? (
            <Pressable accessibilityLabel="Ajouter des médias" disabled={busy} onPress={upload} className="h-[44px] w-[44px] items-center justify-center rounded-full bg-brand">
              {busy ? <ActivityIndicator size="small" color="#141414" /> : <Ionicons name="cloud-upload-outline" size={22} color="#141414" />}
            </Pressable>
          ) : undefined
        }
      />

      {progress ? (
        <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3">
          <ActivityIndicator size="small" color="#2F4A00" />
          <Text className="font-jakarta text-[13px] font-medium text-brand-ink">{`Envoi en cours… ${Math.min(progress.done + 1, progress.total)}/${progress.total}`}</Text>
        </View>
      ) : null}

      {items === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#2F4A00" />
        </View>
      ) : (
        <FlatList
          className="flex-1 px-4"
          data={items}
          numColumns={COLUMNS}
          key={COLUMNS}
          keyExtractor={(m) => m.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#2F4A00"
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          renderItem={({ item, index }) => (
            <Reanimated.View entering={ZoomIn.duration(300).delay(Math.min(index, 12) * 35)}>
            <Pressable onLongPress={canWrite ? () => { haptic.medium(); setToDelete(item); } : undefined} delayLongPress={350}>
              <MediaThumb uri={item.thumbUrl ?? (item.kind === "image" ? item.url : null)} kind={item.kind} size={size} />
            </Pressable>
            </Reanimated.View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="images-outline"
              title="Aucun média pour l’instant"
              text={canWrite ? "Ajoutez des images ou des vidéos depuis votre téléphone : vous pourrez ensuite les joindre à vos publications. Appui long sur un média pour le supprimer." : "Les médias de votre organisation apparaîtront ici."}
              primary={canWrite ? { label: "Ajouter des médias", onPress: upload } : undefined}
            />
          }
        />
      )}

      <ConfirmSheet
        visible={toDelete !== null}
        title="Supprimer ce média ?"
        message="Le fichier sera supprimé de votre médiathèque. S’il est utilisé par une publication en attente, il est conservé."
        confirmLabel="Oui, supprimer"
        danger
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </SafeAreaView>
  );
}
