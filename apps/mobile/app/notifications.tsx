import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useCallback, useEffect, useMemo } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Image } from "@/components/ui/image";
import { useNotificationsStore } from "@/store/notifications-store";
import type { NotificationItem } from "@/types";

function NotificationCard({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="w-full flex-row items-center rounded-[10px] bg-channel-active-bg p-3">
      <View className="flex-1 gap-[6px] pr-2">
        <Text numberOfLines={1} className="font-jakarta text-[13px] font-bold leading-[18px] text-text-primary">
          {item.title}
        </Text>
        {item.body ? (
          <Text numberOfLines={3} className="font-jakarta text-[13px] font-medium leading-[18px] text-text-primary">
            {item.body}
          </Text>
        ) : null}
        <Text className="font-jakarta text-[10px] font-medium leading-[15px] text-text-secondary">
          {format(parseISO(item.createdAt), "d MMMM yyyy • HH:mm", { locale: fr })}
        </Text>
      </View>

      <View className="w-6 items-center justify-center self-stretch">
        {item.unread ? <View className="h-[9px] w-[9px] rounded-full bg-main-accent-pink" /> : null}
      </View>
    </Pressable>
  );
}

function dayTitle(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Aujourd’hui";
  if (isYesterday(d)) return "Hier";
  return format(d, "d MMMM", { locale: fr });
}

function groupByDay(items: NotificationItem[]): { title: string; items: NotificationItem[] }[] {
  const groups: { title: string; items: NotificationItem[] }[] = [];
  for (const item of items) {
    const title = dayTitle(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(item);
    else groups.push({ title, items: [item] });
  }
  return groups;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const items = useNotificationsStore((state) => state.items);
  const sections = useMemo(() => groupByDay(items), [items]);
  const hasUnread = items.some((n) => n.unread);

  const openItem = useCallback(
    (item: NotificationItem) => {
      void useNotificationsStore.getState().markAsRead(item.id);
      const conversationId = item.data.conversation_id;
      if (typeof conversationId === "string" && conversationId) {
        router.replace(`/conversation/${conversationId}` as never);
      } else if (typeof item.data.post_id === "string") {
        router.back();
      }
    },
    [router],
  );
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(0);

  const doBack = useCallback(() => {
    router.back();
  }, [router]);

  // Animate out to the right, then actually pop the screen
  const animatedClose = useCallback(() => {
    translateX.value = withTiming(
      screenWidth,
      { duration: 280, easing: Easing.out(Easing.cubic) },
      () => {
        runOnJS(doBack)();
      },
    );
  }, [translateX, screenWidth, doBack]);

  // Intercept Android hardware back button to use our animated close
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      animatedClose();
      return true;
    });
    return () => sub.remove();
  }, [animatedClose]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>
      <SafeAreaView className="flex-1 bg-main-sections" edges={["top", "bottom"]}>
        <StatusBar style="light" />

        <View className="h-[60px] flex-row items-center justify-between px-4">
          <Pressable
            className="h-6 w-6 items-center justify-center"
            onPress={animatedClose}
          >
            <Image
              source={require("@/assets/icons/create-post/back.svg")}
              className="h-[13.5px] w-[7.5px]"
              contentFit="contain"
            />
          </Pressable>

          <Text className="font-jakarta text-[20px] font-semibold leading-7 text-text-primary">
            Notifications
          </Text>

          <Pressable
            hitSlop={8}
            disabled={!hasUnread}
            onPress={() => void useNotificationsStore.getState().markAllAsRead()}
          >
            <Text className={`font-jakarta text-[12px] font-semibold ${hasUnread ? "text-main-accent-pink" : "text-text-tertiary"}`}>
              Tout lire
            </Text>
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pb-6 pt-4"
          showsVerticalScrollIndicator={false}
        >
          {sections.length === 0 ? (
            <Text className="mt-10 text-center font-jakarta text-body-1 text-text-secondary">
              Aucune notification pour le moment.
            </Text>
          ) : null}
          {sections.map((section, index) => (
            <View key={section.title} className={index > 0 ? "mt-5" : undefined}>
              <Text className="font-jakarta text-[14px] font-semibold leading-5 text-text-primary">
                {section.title}
              </Text>

              <View className="mt-2 gap-2">
                {section.items.map((item) => (
                  <NotificationCard key={item.id} item={item} onPress={() => openItem(item)} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}
