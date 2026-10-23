import type { ChannelNetwork } from "@/types";

const LABELS: Partial<Record<ChannelNetwork, string>> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  "linkedin-page": "LinkedIn",
  "instagram-business": "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Nom affiché d'un réseau. */
export function formatNetworkLabel(network: ChannelNetwork): string {
  return LABELS[network] ?? network.charAt(0).toUpperCase() + network.slice(1);
}
