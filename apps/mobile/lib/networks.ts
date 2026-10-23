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

// La base distingue « linkedin_page » (Page) et « instagram_standalone » (connexion Instagram directe) ; l'interface les affiche comme LinkedIn et Instagram.
const PROVIDER_ALIAS: Record<string, ChannelNetwork> = { linkedin_page: "linkedin", instagram_standalone: "instagram" };

/** Réseau affiché pour un fournisseur de la base. */
export function normalizeProvider(provider: string): ChannelNetwork {
  return PROVIDER_ALIAS[provider] ?? (provider as ChannelNetwork);
}
