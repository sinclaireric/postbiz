import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmSheet, PageHeader } from "@/components/ui/kit";
import { Image } from "@/components/ui/image";
import { showToast } from "@/components/ui/toast";
import { deleteMedia, listMedia, pickAndUpload, type MediaItem } from "@/lib/media";
import { useOrgStore } from "@/store/org-store";

const GAP = 6;
const COLUMNS = 3;

const STATUS_LABEL: Record<MediaItem["status"], string> = {
  uploaded: "Envoyé",
  processing: "Traitement…",
  ready: "",
  failed: "Échec",
};

export default function MediaScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const orgId = useOrgStore((s) => s.current?.id);
  const canWrite = useOrgStore((s) => s.canWrite);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);

  const size = (width - 32 - GAP * (COLUMNS - 1)) / COLUMNS;

  const load = useCallback(async () => {
    if (orgId) setItems(await listMedia(orgId));
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    setBusy(true);
    const result = await pickAndUpload();
    setBusy(false);
    if (!result.ok) showToast(result.error, "error");
    else if (result.count) showToast(`${result.count} média${result.count > 1 ? "s" : ""} ajouté${result.count > 1 ? "s" : ""}`, "success");
    await load();
  };

  const remove = async () => {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    const result = await deleteMedia(target);
    showToast(result.ok ? "Média supprimé" : result.error, result.ok ? "success" : "error");
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
          contentContainerStyle={{ gap: GAP, paddingBottom: 24 }}
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
          renderItem={({ item }) => {
            const isVideo = item.mimeType?.startsWith("video/");
            return (
              <Pressable
                onLongPress={canWrite ? () => setToDelete(item) : undefined}
                style={{ width: size, height: size }}
                className="overflow-hidden rounded-[8px] bg-chip-bg"
              >
                {item.url && !isVideo ? (
                  <Image source={{ uri: item.url }} style={{ width: size, height: size }} contentFit="cover" />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Ionicons name={isVideo ? "videocam-outline" : "image-outline"} size={28} color="#9A9AA0" />
                  </View>
                )}
                {isVideo ? (
                  <View className="absolute bottom-1 left-1 rounded bg-black/60 px-1">
                    <Ionicons name="play" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
                {STATUS_LABEL[item.status] ? (
                  <View className="absolute right-1 top-1 rounded bg-black/60 px-1">
                    <Text className="font-jakarta text-[10px] text-white">{STATUS_LABEL[item.status]}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View className="items-center px-8 pt-16">
              <Text className="text-center font-jakarta text-h4 font-semibold text-text-primary">Aucun média pour l’instant</Text>
              <Text className="mt-2 text-center font-jakarta text-body-1 text-text-secondary">
                Ajoutez des images ou des vidéos : elles seront stockées dans votre espace privé.
                {canWrite ? "\nAppui long sur un média pour le supprimer." : ""}
              </Text>
              <Text className="mt-3 text-center font-jakarta text-[12px] text-text-secondary">
                L’ajout d’un média à une publication n’est pas encore disponible.
              </Text>
            </View>
          }
        />
      )}

      <ConfirmSheet
        visible={toDelete !== null}
        title="Supprimer ce média ?"
        message="Le fichier sera supprimé de votre médiathèque."
        confirmLabel="Oui, supprimer"
        danger
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </SafeAreaView>
  );
}
