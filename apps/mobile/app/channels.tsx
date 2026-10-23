import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { EmptyState, IconCircle, PageHeader } from "@/components/ui/kit";
import { formatNetworkLabel } from "@/lib/networks";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  active: { label: "Connecté", fg: "#0A7A3B", bg: "#DDF5E6" },
  refresh_needed: { label: "À reconnecter", fg: "#B42318", bg: "#FDE7E4" },
  disabled: { label: "Désactivé", fg: "#5E5E5A", bg: "#EFEDE7" },
};

export default function ChannelsScreen() {
  const router = useRouter();
  const channels = useChannelsStore((s) => s.channels);
  const canWrite = useOrgStore((s) => s.canWrite);

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />
      <PageHeader title="Canaux" onBack={() => router.back()} right={canWrite ? <IconCircle icon="add" label="Ajouter un canal" onPress={() => router.push("/add-channel")} /> : undefined} />
      <FlatList
        className="flex-1"
        data={channels}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
        ListEmptyComponent={
          <EmptyState
            icon="share-social-outline"
            title="Connectez votre premier canal"
            text="Il faut au moins un compte connecté pour programmer des publications et recevoir vos messages."
            primary={canWrite ? { label: "Connecter un canal", onPress: () => router.push("/add-channel") } : undefined}
          />
        }
        renderItem={({ item }) => {
          const st = STATUS[item.status ?? "active"] ?? STATUS.active;
          return (
            <View className="flex-row items-center gap-4 rounded-[22px] border border-line bg-card p-4">
              <ChannelAvatar avatar={item.avatar} network={item.network} name={item.name} size={48} />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="font-jakarta text-[17px] font-semibold text-ink">{item.name}</Text>
                <Text numberOfLines={1} className="font-jakarta text-[14px] text-ink-soft">
                  {formatNetworkLabel(item.network)}
                  {item.username ? ` · @${item.username}` : ""}
                </Text>
              </View>
              <View className="rounded-full px-3 py-[5px]" style={{ backgroundColor: st.bg }}>
                <Text className="font-jakarta text-[12px] font-semibold" style={{ color: st.fg }}>{st.label}</Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={channels.length > 0 ? <Text className="px-2 pt-2 text-center font-jakarta text-[12px] text-ink-muted">Pour reconnecter ou retirer un canal, utilisez Postbiz sur le web.</Text> : undefined}
      />
    </SafeAreaView>
  );
}
