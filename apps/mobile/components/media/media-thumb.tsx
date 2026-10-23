import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { Image } from "@/components/ui/image";
import type { MediaKind } from "@/lib/media-rules";

/** Vignette carrée d'un média : image (ou vignette) et badge lecture pour une vidéo. */
export function MediaThumb({ uri, kind, size, radius = 12, label }: { uri: string | null; kind: MediaKind; size: number; radius?: number; label?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", backgroundColor: "#EFEDE7", alignItems: "center", justifyContent: "center" }}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" /> : <Ionicons name={kind === "video" ? "videocam-outline" : "image-outline"} size={Math.round(size * 0.32)} color="#9A9890" />}
      {kind === "video" ? (
        <View style={{ position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Ionicons name="play" size={10} color="#FFFFFF" />
          {label ? <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "600" }}>{label}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
