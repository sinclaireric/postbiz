import { Linking, Pressable, View } from "react-native";

import { MediaThumb } from "@/components/media/media-thumb";
import type { AgentMedia } from "@/lib/agent-protocol";
import { haptic } from "@/lib/haptics";

/** Les images que l'agent a générées dans un message : déjà dans la médiathèque. Un appui ouvre l'image en grand. */
export function GeneratedImages({ items }: { items: Pick<AgentMedia, "id" | "kind" | "name" | "url" | "thumbUrl">[] }) {
  if (items.length === 0) return null;
  return (
    <View accessibilityLabel="Images générées" className="mt-3 flex-row flex-wrap gap-2.5">
      {items.map((m) => (
        <Pressable
          key={m.id} accessibilityRole="imagebutton" accessibilityLabel={`Voir l’image « ${m.name} »`} disabled={!m.url}
          onPress={() => { haptic.tap(); if (m.url) void Linking.openURL(m.url); }}
        >
          <MediaThumb uri={m.thumbUrl ?? m.url} kind={m.kind} size={150} radius={18} />
        </Pressable>
      ))}
    </View>
  );
}
