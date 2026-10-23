import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { MediaThumb } from "@/components/media/media-thumb";
import { haptic } from "@/lib/haptics";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { formatNetworkLabel } from "@/lib/networks";
import type { ScheduledPost } from "@/types";
import { htmlToPlain } from "@/utils/text";

const STATE: Record<string, { label: string; fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  draft: { label: "Brouillon", fg: "#5E5E5A", bg: "#EFEDE7", icon: "create-outline" },
  queued: { label: "Programmée", fg: "#2F4A00", bg: "#EEF8C9", icon: "time-outline" },
  publishing: { label: "Envoi en cours", fg: "#8A5A00", bg: "#FFF1CC", icon: "paper-plane-outline" },
  published: { label: "Publiée", fg: "#0A7A3B", bg: "#DDF5E6", icon: "checkmark-circle-outline" },
  error: { label: "Échec", fg: "#B42318", bg: "#FDE7E4", icon: "alert-circle-outline" },
  unknown: { label: "Résultat incertain", fg: "#B42318", bg: "#FDE7E4", icon: "help-circle-outline" },
};

/** Carte d'une publication dans la liste : compte, heure, texte, état. Touchez pour l'aperçu, ⋮ pour les actions. */
export const PostCard = memo(function PostCard({ post, onPress, onMenu }: { post: ScheduledPost; onPress: () => void; onMenu: (post: ScheduledPost) => void }) {
  const st = STATE[post.dbState ?? "queued"] ?? STATE.queued;
  const text = htmlToPlain(post.content) || "(sans texte)";
  const threadCount = post.composerPosts?.length ?? 1;
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View
      style={[
        { borderRadius: 22, borderWidth: 1, borderColor: "#E7E5DF", backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
        pressStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => (press.value = withTiming(0.975, { duration: 90 }))}
        onPressOut={() => (press.value = withSpring(1, { damping: 10, stiffness: 240 }))}
        accessibilityRole="button"
        className="p-4"
      >
        <View className="flex-row items-center gap-3 pr-10">
          <ChannelAvatar avatar={post.authorAvatar} network={post.network} name={post.authorName} size={44} />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <Ionicons name="time-outline" size={16} color="#141414" />
              <Text className="font-jakarta text-[15px] font-semibold text-ink">{format(parseISO(post.scheduledAt), "HH:mm")}</Text>
            </View>
            <Text numberOfLines={1} className="font-jakarta text-[12.5px] text-ink-soft">
              {post.authorName || formatNetworkLabel(post.network)}
            </Text>
          </View>
        </View>

        <View className="mt-3 flex-row items-start gap-3">
          <Text numberOfLines={5} className="min-w-0 flex-1 font-jakarta text-[14.5px] leading-[20.5px] text-ink">
            {text}
          </Text>
          {post.media && post.media.length > 0 ? (
            <View>
              <MediaThumb uri={post.media[0].thumbUrl} kind={post.media[0].kind} size={92} radius={14} />
              {post.media.length > 1 ? (
                <View className="absolute right-1 top-1 rounded-full bg-black/60 px-[7px] py-[2px]">
                  <Text className="font-jakarta text-[10px] font-bold text-white">+{post.media.length - 1}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {post.errorMessage && (post.dbState === "error" || post.dbState === "unknown") ? (
          <Text numberOfLines={2} className="mt-2 font-jakarta text-[12px] text-text-critical">
            {post.errorMessage}
          </Text>
        ) : null}

        <View className="mt-4 flex-row items-center gap-2 border-t border-line pt-3">
          <View className="flex-row items-center gap-1 rounded-full px-3 py-[5px]" style={{ backgroundColor: st.bg }}>
            <Ionicons name={st.icon} size={14} color={st.fg} />
            <Text className="font-jakarta text-[11px] font-semibold" style={{ color: st.fg }}>
              {st.label}
            </Text>
          </View>
          <Text className="font-jakarta text-[11px] text-ink-muted">{formatNetworkLabel(post.network)}</Text>
          {threadCount > 1 ? <Text className="font-jakarta text-[11px] text-ink-muted">· fil de {threadCount}</Text> : null}
        </View>
      </Pressable>

      {/* Hors du Pressable principal : un bouton ne peut pas en contenir un autre (web). */}
      <Pressable
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Actions"
        onPress={() => { haptic.tap(); onMenu(post); }}
        className="absolute right-3 top-4 h-10 w-10 items-center justify-center"
      >
        <Ionicons name="ellipsis-vertical" size={20} color="#141414" />
      </Pressable>
    </Animated.View>
  );
});
