import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { formatNetworkLabel } from "@/lib/networks";
import { ChannelAvatar } from "@/components/ui/channel-avatar";
import { Popover, useAnchor } from "@/components/ui/popover";
import type { Channel } from "@/types";

/**
 * Sélecteur de canal : pilule (« Tous les canaux » ou le canal choisi) qui ouvre la liste des canaux connectés.
 * `compact` réduit la pilule à l'avatar (quand la bande de la semaine est affichée).
 */
export function ChannelPicker({
  channels,
  value,
  onChange,
  compact = false,
  allLabel = "Tous les canaux",
  allowAll = true,
}: {
  channels: Channel[];
  value: string | null;
  onChange: (id: string | null) => void;
  compact?: boolean;
  allLabel?: string;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const { ref, anchor, open, close } = useAnchor();
  const current = channels.find((c) => c.id === value) ?? null;

  const pick = (id: string | null) => {
    onChange(id);
    close();
  };

  return (
    <View ref={ref} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choisir un canal"
        onPress={open}
        className="h-[46px] flex-row items-center gap-2 rounded-full bg-card px-3"
        style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
      >
        {current ? (
          <ChannelAvatar avatar={current.avatar} network={current.network} name={current.name} size={30} />
        ) : (
          <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-chip-bg">
            <Ionicons name="apps" size={16} color="#141414" />
          </View>
        )}
        {compact ? null : (
          <Text numberOfLines={1} className="max-w-[170px] font-jakarta text-[16px] font-medium text-ink">
            {current ? current.name : allLabel}
          </Text>
        )}
        <Ionicons name="swap-vertical" size={16} color="#141414" />
      </Pressable>

      <Popover anchor={anchor} onClose={close} width={340} align="left" matchAnchorWidth>
        {allowAll ? (
          <Pressable onPress={() => pick(null)} className="flex-row items-center gap-3 border-b border-line px-4 py-4">
            <View className="h-[42px] w-[42px] items-center justify-center rounded-full bg-chip-bg">
              <Ionicons name="apps" size={20} color="#141414" />
            </View>
            <Text className="flex-1 font-jakarta text-[17px] font-semibold text-ink">{allLabel}</Text>
            {!value ? <Ionicons name="checkmark" size={22} color="#2F4A00" /> : null}
          </Pressable>
        ) : null}

        {channels.map((c) => (
          <Pressable key={c.id} onPress={() => pick(c.id)} className="flex-row items-center gap-3 px-4 py-3">
            <ChannelAvatar avatar={c.avatar} network={c.network} name={c.name} size={42} />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="font-jakarta text-[16px] font-medium text-ink">{c.name}</Text>
              <Text numberOfLines={1} className="font-jakarta text-[13px] text-ink-soft">
                {formatNetworkLabel(c.network)}
                {c.status && c.status !== "active" ? " · à reconnecter" : ""}
              </Text>
            </View>
            {value === c.id ? <Ionicons name="checkmark" size={22} color="#2F4A00" /> : null}
          </Pressable>
        ))}

        <Pressable
          onPress={() => {
            close();
            setTimeout(() => router.push("/add-channel"), 120);
          }}
          className="flex-row items-center gap-3 border-t border-line px-4 py-4"
        >
          <View className="h-[42px] w-[42px] items-center justify-center rounded-full bg-chip-bg">
            <Ionicons name="add" size={22} color="#141414" />
          </View>
          <Text className="font-jakarta text-[16px] text-ink">Ajouter un canal</Text>
        </Pressable>
      </Popover>
    </View>
  );
}
