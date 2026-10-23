import { FontAwesome6 } from "@expo/vector-icons";
import Svg, { Circle, Ellipse, G, Line, Path } from "react-native-svg";

import type { ChannelNetwork } from "@/types";

// Logos des réseaux (police Font Awesome Brands) et marques d'IA dessinées en SVG.
// Les marques Claude et ChatGPT sont des approximations simplifiées : à remplacer par les fichiers officiels
// (respecter leurs chartes de marque) avant toute communication publique.

const NETWORK_GLYPH: Partial<Record<ChannelNetwork, string>> = {
  facebook: "facebook-f",
  instagram: "instagram",
  x: "x-twitter",
  linkedin: "linkedin-in",
  tiktok: "tiktok",
  youtube: "youtube",
  threads: "threads",
  pinterest: "pinterest",
  mastodon: "mastodon",
  bluesky: "bluesky",
  reddit: "reddit",
};

/** Couleur d'identification du réseau (fond du badge). */
export const NETWORK_COLOR: Partial<Record<ChannelNetwork, string>> = {
  facebook: "#1877F2",
  instagram: "#E1306C",
  x: "#111111",
  linkedin: "#0A66C2",
  tiktok: "#111111",
  youtube: "#FF0000",
  threads: "#111111",
  pinterest: "#E60023",
  mastodon: "#6364FF",
  bluesky: "#1185FE",
  reddit: "#FF4500",
};

export function NetworkGlyph({ network, size = 16, color = "#FFFFFF" }: { network: ChannelNetwork; size?: number; color?: string }) {
  const name = NETWORK_GLYPH[network] ?? "share-nodes";
  return <FontAwesome6 name={name as never} brand={!!NETWORK_GLYPH[network]} size={size} color={color} />;
}

/** Marque Claude (étoile à rayons arrondis), approximation. */
export function ClaudeMark({ size = 28, color = "#D97757" }: { size?: number; color?: string }) {
  const rays = 12;
  return (
    <Svg width={size} height={size} viewBox="-50 -50 100 100">
      <G>
        {Array.from({ length: rays }).map((_, i) => {
          const a = (i * 360) / rays;
          const len = i % 2 === 0 ? 40 : 32;
          return <Line key={i} x1="0" y1="-8" x2="0" y2={-len} stroke={color} strokeWidth={9} strokeLinecap="round" transform={`rotate(${a})`} />;
        })}
      </G>
    </Svg>
  );
}

/** Marque ChatGPT / OpenAI (fleur à six boucles), approximation. */
export function OpenAIMark({ size = 28, color = "#111111" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="-50 -50 100 100">
      {Array.from({ length: 6 }).map((_, i) => (
        <Ellipse key={i} cx="0" cy="-20" rx="13" ry="25" fill="none" stroke={color} strokeWidth={6} transform={`rotate(${i * 60})`} />
      ))}
      <Circle cx="0" cy="0" r="4" fill={color} />
    </Svg>
  );
}

/** Étincelles « agent » (3 étoiles à quatre branches). */
export function SparklesMark({ size = 24, color = "#111111" }: { size?: number; color?: string }) {
  const star = (cx: number, cy: number, r: number) =>
    `M${cx} ${cy - r} Q${cx} ${cy} ${cx + r} ${cy} Q${cx} ${cy} ${cx} ${cy + r} Q${cx} ${cy} ${cx - r} ${cy} Q${cx} ${cy} ${cx} ${cy - r}Z`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={star(40, 55, 34)} fill={color} />
      <Path d={star(78, 24, 16)} fill={color} />
      <Path d={star(80, 80, 12)} fill={color} />
    </Svg>
  );
}
