import type { ChannelNetwork } from "@/types";

export type ComposerPost = {
  id: string;
  content: string;
  imageUris: string[];
};

export type MediaSheetState = "empty" | "loading" | "library";

export type SettingsSheet = "main" | "network" | "tags" | "new-tag" | "repeat" | null;

export type ComposerTag = {
  id: string;
  label: string;
  color: string;
  selected: boolean;
};

export const MEDIA_TOOLS = [
  { id: "insert", icon: require("@/assets/icons/create-post/toolbar-image-plus.svg") },
  { id: "design", icon: require("@/assets/icons/create-post/toolbar-image.svg") },
  { id: "ai-image", icon: require("@/assets/icons/create-post/toolbar-sparkles.svg") },
  { id: "ai-video", icon: require("@/assets/icons/create-post/toolbar-film.svg") },
];

export const FORMAT_TOOLS = [
  { id: "underline", icon: require("@/assets/icons/create-post/toolbar-underline.svg") },
  { id: "bold", icon: require("@/assets/icons/create-post/toolbar-bold.svg") },
];

export const POST_ACTIONS = [
  { id: "calendar", label: "Programmer", tone: "primary" as const },
  { id: "now", label: "Publier maintenant", tone: "secondary" as const },
  { id: "draft", label: "Enregistrer en brouillon", tone: "tertiary" as const },
];

export const REPEAT_OPTIONS = [
  "Ne pas répéter",
  "Tous les jours",
  "Tous les trois jours",
  "Toutes les semaines",
  "Tous les mois",
] as const;

export const TAG_COLOR_OPTIONS = ["#5D5FFF", "#E323E0", "#3023E3", "#E89623"] as const;

export const DELAY_OPTIONS = ["Immédiatement", "Après 5 minutes", "Après 15 minutes"] as const;

const ALL_MEDIA_ASSETS = [
  { id: "media-1", uri: "https://picsum.photos/seed/postbiz-media-1/720/720" },
  { id: "media-2", uri: "https://picsum.photos/seed/postbiz-media-2/720/720" },
  { id: "media-3", uri: "https://picsum.photos/seed/postbiz-media-3/720/720" },
  { id: "media-4", uri: "https://picsum.photos/seed/postbiz-media-4/720/720" },
  { id: "media-5", uri: "https://picsum.photos/seed/postbiz-media-5/720/720" },
  { id: "media-6", uri: "https://picsum.photos/seed/postbiz-media-6/720/720" },
];

export const MEDIA_LIBRARY_ASSETS = ALL_MEDIA_ASSETS;

export const INITIAL_TAGS: ComposerTag[] = [
  { id: "personal", label: "Personnel", color: "#5D5FFF", selected: true },
  { id: "important", label: "Important", color: "#E323E0", selected: false },
  { id: "general", label: "Général", color: "#3023E3", selected: false },
];

export function makePost(id: string, content: string, imageUris: string[] = []): ComposerPost {
  return { id, content, imageUris };
}

export function formatNetworkLabel(network: ChannelNetwork) {
  if (network === "x") return "X";
  if (network === "linkedin" || network === "linkedin-page") return "LinkedIn";
  if (network === "instagram" || network === "instagram-business") return "Instagram";
  if (network === "google-business") return "Google Business";

  return network
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
