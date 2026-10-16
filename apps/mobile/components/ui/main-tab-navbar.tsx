import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "@/components/ui/image";
import { useInboxUnreadCount } from "@/store/inbox-store";

type TabName = "calendar" | "channels" | "inbox" | "settings";

type MainTabNavbarProps = {
  activeTab: TabName;
};

type MenuButtonProps = {
  activeIconSource: any;
  inactiveIconSource: any;
  active?: boolean;
  onPress?: () => void;
};

function MenuButton({
  activeIconSource,
  inactiveIconSource,
  active = false,
  onPress,
}: MenuButtonProps) {
  return (
    <Pressable
      className={`h-11 w-11 items-center justify-center ${active ? "rounded-[8px] bg-buttons-menu-bg-active" : "rounded-[12px]"}`}
      onPress={onPress}
    >
      <Image
        source={active ? activeIconSource : inactiveIconSource}
        className="w-6 h-6"
        contentFit="contain"
      />
    </Pressable>
  );
}

export function MainTabNavbar({ activeTab }: MainTabNavbarProps) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const inboxUnread = useInboxUnreadCount();

  return (
    <View className="w-full bg-main-sections-2" style={{ paddingBottom: bottom }}>
      <View className="h-[68px] w-full flex-row items-center justify-around">
        <MenuButton
          activeIconSource={require("@/assets/icons/navbar/calendar-active.svg")}
          inactiveIconSource={require("@/assets/icons/navbar/calendar.svg")}
          active={activeTab === "calendar"}
          onPress={() => {
            if (activeTab !== "calendar") {
              router.replace("/(tabs)");
            }
          }}
        />

        <MenuButton
          activeIconSource={require("@/assets/icons/navbar/channels-active.svg")}
          inactiveIconSource={require("@/assets/icons/navbar/channels.svg")}
          active={activeTab === "channels"}
          onPress={() => {
            if (activeTab !== "channels") {
              router.replace("/(tabs)/explore");
            }
          }}
        />

        <Pressable
          accessibilityLabel="Nouvelle publication"
          className="h-11 w-11 items-center justify-center rounded-[8px] bg-buttons-primary-bg"
          onPress={() => router.push("/create-post")}
        >
          <Image source={require("@/assets/icons/navbar/plus.svg")} className="w-5 h-5" contentFit="contain" />
        </Pressable>

        <Pressable
          accessibilityLabel="Boîte de réception"
          className={`h-11 w-11 items-center justify-center ${activeTab === "inbox" ? "rounded-[8px] bg-buttons-menu-bg-active" : "rounded-[12px]"}`}
          onPress={() => {
            if (activeTab !== "inbox") {
              router.replace("/(tabs)/inbox");
            }
          }}
        >
          <Ionicons
            name={activeTab === "inbox" ? "chatbubbles" : "chatbubbles-outline"}
            size={24}
            color={activeTab === "inbox" ? "#0E0E0E" : "#A3A3A3"}
          />
          {inboxUnread > 0 ? (
            <View className="absolute right-0 top-0 min-w-[16px] items-center rounded-full bg-main-accent-pink px-1">
              <Text className="font-jakarta text-[10px] font-bold text-main-bg">{inboxUnread > 99 ? "99+" : inboxUnread}</Text>
            </View>
          ) : null}
        </Pressable>

        <MenuButton
          activeIconSource={require("@/assets/icons/navbar/settings-active.svg")}
          inactiveIconSource={require("@/assets/icons/navbar/settings.svg")}
          active={activeTab === "settings"}
          onPress={() => {
            if (activeTab !== "settings") {
              router.replace("/(tabs)/settings");
            }
          }}
        />
      </View>
    </View>
  );
}
