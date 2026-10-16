import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { Image } from "@/components/ui/image";
import { OnboardingIcons } from "@/components/ui/onboarding-icons";
import { MainTabNavbar } from "@/components/ui/main-tab-navbar";
import { NetworkBadge } from "@/components/ui/network-badge";
import { NotificationBellButton } from "@/components/ui/notification-bell-button";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";
import type { Channel } from "@/types";

const STATUS_LABEL: Record<NonNullable<Channel["status"]>, string> = {
  active: "",
  refresh_needed: "À reconnecter",
  disabled: "Désactivé",
};

function ChannelRow({ channel, canCreate, onCreatePost }: { channel: Channel; canCreate: boolean; onCreatePost: () => void }) {
  return (
    <View className="w-full flex-row items-center gap-2 px-2 py-2">
      <View className="min-h-px min-w-px flex-1 flex-row items-center gap-3">
        <View className="relative">
          <Image
            source={{ uri: channel.avatar }}
            className="w-10 h-10 rounded-lg"
            contentFit="cover"
          />
          <NetworkBadge network={channel.network} />
        </View>

        <View className="flex-1">
          <Text className="font-jakarta text-[14px] font-semibold text-text-primary">
            {channel.name}
          </Text>
          {channel.status && channel.status !== "active" ? (
            <Text className="font-jakarta text-[12px] text-text-critical">{STATUS_LABEL[channel.status]}</Text>
          ) : channel.username ? (
            <Text className="font-jakarta text-[12px] text-text-secondary">@{channel.username}</Text>
          ) : null}
        </View>
      </View>

      {canCreate ? (
        <Pressable
          className="h-[34px] w-[34px] items-center justify-center rounded-[6px] bg-buttons-primary-bg"
          onPress={onCreatePost}
        >
          <Ionicons name="add" size={20} className="text-white" />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ChannelsAddedScreen() {
  const router = useRouter();
  const channels = useChannelsStore((state) => state.channels);
  const canWrite = useOrgStore((state) => state.canWrite);

  return (
    <SafeAreaView
      className="flex-1 bg-background-primary"
      edges={["top"]}
    >
      <StatusBar style="light" />

      <View className="h-[60px] flex-row items-center justify-between px-4">
        <Text className="font-jakarta text-h2 font-semibold text-text-primary">
          Canaux
        </Text>

        <View className="flex-row items-center gap-5">
          <Pressable
            className="h-[34px] flex-row items-center justify-center gap-2 rounded-[6px] bg-buttons-tertiary-bg px-4"
            onPress={() => router.push("/add-channel")}
          >
            <Ionicons name="add" size={16} className="text-white" />
            <Text className="font-jakarta text-[13px] font-semibold text-text-primary">
              Ajouter un canal
            </Text>
          </Pressable>
          <NotificationBellButton />
        </View>
      </View>

      {channels.length === 0 ? (
        <View className="flex-1 overflow-hidden">
          <View className="flex-1 items-center px-5" style={{ paddingTop: 20 }}>
            <OnboardingIcons compact />
            <View className="mt-8 w-full items-center gap-2">
              <Text className="w-[245px] text-center font-jakarta text-2xl font-semibold leading-8 text-text-primary">
                Connectez votre premier canal
              </Text>
              <Text className="w-[275px] text-center font-jakarta text-sm text-[rgba(255,255,255,0.6)]">
                Il faut au moins un compte connecté pour programmer et publier des posts.
              </Text>
            </View>
          </View>
          <View className="px-5" style={{ paddingBottom: 16 }}>
            <AppButton
              label="Connecter un canal"
              onPress={() => router.push("/add-channel")}
            />
          </View>
        </View>
      ) : (
      <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ gap: 4, paddingTop: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              canCreate={canWrite && (channel.status ?? "active") === "active"}
              onCreatePost={() => router.push({ pathname: "/create-post", params: { channelId: channel.id } } as any)}
            />
          ))}
        </ScrollView>
      )}

      <MainTabNavbar activeTab="channels" />

    </SafeAreaView>
  );
}
