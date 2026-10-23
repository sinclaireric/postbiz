import { Text, View } from "react-native";

import { Image } from "@/components/ui/image";
import { NETWORK_COLOR, NetworkGlyph } from "@/components/ui/brand-icon";
import type { ChannelNetwork } from "@/types";

/** Avatar rond d'un compte, avec la pastille du réseau en bas à droite (initiale si le réseau ne fournit pas d'image). */
export function ChannelAvatar({
  avatar,
  network,
  name,
  size = 40,
  badge = true,
}: {
  avatar?: string | null;
  network: ChannelNetwork;
  name?: string;
  size?: number;
  badge?: boolean;
}) {
  const badgeSize = Math.max(14, Math.round(size * 0.42));
  return (
    <View style={{ width: size, height: size }}>
      {avatar ? (
        <Image source={{ uri: avatar }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: NETWORK_COLOR[network] ?? "#9A9890", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: size * 0.42 }}>{(name?.trim()[0] ?? "?").toUpperCase()}</Text>
        </View>
      )}
      {badge ? (
        <View
          style={{
            position: "absolute",
            right: -3,
            bottom: -3,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: NETWORK_COLOR[network] ?? "#9A9890",
            borderWidth: 1.5,
            borderColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <NetworkGlyph network={network} size={Math.round(badgeSize * 0.52)} />
        </View>
      ) : null}
    </View>
  );
}
