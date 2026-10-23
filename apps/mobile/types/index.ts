import type { Ionicons } from "@expo/vector-icons";

export type ChannelNetwork =
  | "x"
  | "linkedin"
  | "linkedin-page"
  | "reddit"
  | "instagram"
  | "instagram-business"
  | "facebook"
  | "threads"
  | "youtube"
  | "google-business"
  | "tiktok"
  | "pinterest"
  | "dribbble"
  | "discord"
  | "slack"
  | "kick"
  | "twitch"
  | "mastodon"
  | "bluesky"
  | "lemmy"
  | "farcaster"
  | "telegram"
  | "nostr"
  | "vk"
  | "medium"
  | "devto"
  | "hashnode"
  | "wordpress"
  | "listmonk"
  | "moltbook"
  | "whop"
  | "skool"
  | "mewe";

export type Channel = {
  id: string;
  name: string;
  network: ChannelNetwork;
  /** URL de l'avatar du compte ; chaîne vide si le réseau n'en fournit pas. */
  avatar: string;
  username?: string | null;
  /** `active` | `refresh_needed` | `disabled` : un canal à reconnecter ne publie plus. */
  status?: "active" | "refresh_needed" | "disabled";
};

/** Ligne de la table `notifications` (une par événement : publication échouée, message reçu...). */
export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Charge utile libre ; `conversation_id` ou `post_id` servent à ouvrir l'écran concerné. */
  data: Record<string, unknown>;
  createdAt: string; // ISO
  unread: boolean;
};

export type NetworkConfig = {
  bg: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export type ChartSpec = {
  data: { value: number }[];
  color: string;
};

// --- Calendar / Scheduled Post types ---

/** `draft` et `scheduled` (queued) sont les seuls états qu'un client peut écrire ; le reste vient du worker. */
export type PostStatus = "scheduled" | "published" | "draft" | "error";

export type PostCategory = "Personal" | "Business" | "Marketing" | "Social";

export type ScheduledPost = {
  id: string;
  title: string;
  content: string;
  category: PostCategory;
  scheduledAt: string; // ISO 8601
  channelId: string;
  network: ChannelNetwork;
  authorName: string;
  authorAvatar: string;
  status: PostStatus;
  imageUri?: string;
  tagLabel?: string;
  tagColor?: string;
  composerPosts?: { id: string; content: string; imageUris: string[] }[];
  /** Un même contenu envoyé vers plusieurs canaux partage ce groupe. */
  groupId?: string;
  /** Message d'erreur du worker quand `status` vaut `error`. */
  errorMessage?: string;
  /** `publishing` : le worker est en train d'envoyer ; `unknown` : issue incertaine, jamais rejouée automatiquement. */
  dbState?: string;
  /** Adresse de la publication chez le réseau, une fois publiée. */
  releaseUrl?: string;
  /** Médias joints, dans l'ordre d'affichage (vignettes signées temporaires). */
  media?: PostMediaItem[];
};

export type PostMediaItem = {
  id: string;
  kind: "image" | "video";
  name: string;
  alt: string;
  /** Vignette (ou l'image elle-même) ; null si le média n'existe plus dans la médiathèque. */
  thumbUrl: string | null;
};

export type TimeSlot = {
  hour: number; // 0-23
  label: string; // "9:00 am"
};

export type CalendarDay = {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasEvents: boolean;
};
