import type { ConversationSummary, MessageItem } from "@/lib/inbox/types";
import { useChannelsStore } from "@/store/channels-store";
import { useInboxStore } from "@/store/inbox-store";
import { useNotificationsStore } from "@/store/notifications-store";
import { usePostsStore } from "@/store/posts-store";
import type { Channel, ScheduledPost } from "@/types";

const at = (days: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const channels: Channel[] = [
  { id: "c-fb", name: "Boulangerie Martin", network: "facebook", avatar: "", username: "boulangeriemartin", status: "active" },
  { id: "c-ig", name: "Boulangerie Martin", network: "instagram", avatar: "", username: "boulangerie.martin", status: "active" },
  { id: "c-x", name: "Martin Pain", network: "x", avatar: "", username: "martinpain", status: "active" },
  { id: "c-li", name: "Martin & Fils", network: "linkedin", avatar: "", username: null, status: "refresh_needed" },
];

const mk = (id: string, ch: Channel, iso: string, text: string, state: string, status: ScheduledPost["status"], extra: Partial<ScheduledPost> = {}): ScheduledPost => ({
  id,
  title: text.slice(0, 40),
  content: text.replace(/\n/g, "<br>"),
  category: "Social",
  scheduledAt: iso,
  channelId: ch.id,
  network: ch.network,
  authorName: ch.name,
  authorAvatar: "",
  status,
  dbState: state,
  composerPosts: [{ id, content: text, imageUris: [] }],
  ...extra,
});

const pic = (seed: string, kind: "image" | "video" = "image") => ({ id: `m-${seed}`, kind, name: `${seed}.jpg`, alt: "", thumbUrl: `https://picsum.photos/seed/${seed}/600/600` });

const posts: ScheduledPost[] = [
  mk("p1", channels[0], at(0, 18, 30), "Nouveau pain aux noix dès samedi à la boulangerie ! 🥖 Offre de lancement pour les 20 premiers clients.\n\n#boulangerie #fabriquémaison", "queued", "scheduled", { media: [pic("pain"), pic("noix")] }),
  mk("p2", channels[1], at(0, 18, 30), "Le pain aux noix arrive samedi 🌰 Venez le goûter !\n\n#boulangerie #painaunoix #artisan", "queued", "scheduled"),
  mk("p3", channels[2], at(1, 9), "Pain aux noix : samedi, 7 h. Les 20 premiers repartent avec une surprise. 🥖", "queued", "scheduled", { media: [pic("surprise")] }),
  mk("p4", channels[0], at(3, 12), "Notre équipe recrute un(e) apprenti(e) boulanger. Envoyez-nous un message !", "draft", "draft"),
  mk("p5", channels[2], at(-1, 8), "Merci pour votre confiance : 1 000 baguettes vendues cette semaine ! 🙏", "published", "published", { releaseUrl: "https://x.com" }),
  mk("p6", channels[0], at(-3, 10, 15), "Horaires du week-end : ouvert samedi et dimanche de 6 h 30 à 13 h.", "published", "published", { releaseUrl: "https://facebook.com", media: [pic("horaires", "video")] }),
  mk("p7", channels[1], at(-2, 17), "Atelier croissants : les inscriptions sont ouvertes.", "error", "error", { errorMessage: "Instagram exige une image ou une vidéo pour publier." }),
];

const conv = (id: string, ch: Channel, name: string, kind: ConversationSummary["kind"], preview: string, min: number, unread: number, windowH: number | null): ConversationSummary => ({
  id,
  networkId: ch.network as ConversationSummary["networkId"],
  accountName: ch.name,
  kind,
  contactName: name,
  contactUsername: name.toLowerCase().replace(/\s+/g, "."),
  status: "open",
  assigneeName: null,
  unreadCount: unread,
  lastMessageAt: ago(min),
  lastMessagePreview: preview,
  replyWindowExpiresAt: windowH === null ? null : new Date(Date.now() + windowH * 3_600_000).toISOString(),
});

const conversations: ConversationSummary[] = [
  conv("v1", channels[0], "Léa Dupont", "dm", "Bonjour, vous faites des gâteaux sur commande ?", 12, 2, 3),
  conv("v2", channels[1], "Karim B.", "comment_thread", "Super photo ! C'est où ?", 95, 1, null),
  conv("v3", channels[0], "Sophie Lambert", "dm", "Merci beaucoup, à samedi !", 600, 0, 20),
  conv("v4", channels[2], "Julien R.", "comment_thread", "Il est sans gluten ?", 2000, 0, null),
];

const msg = (id: string, dir: "in" | "out", body: string, min: number, status: MessageItem["deliveryStatus"] = "received"): MessageItem => ({
  id, direction: dir, body, attachments: [], sentByName: dir === "out" ? "Vous" : null, deliveryStatus: dir === "out" ? "sent" : status, error: null, createdAt: ago(min),
});

/** Remplit les stores avec des données d'exemple (mode démo seulement). */
export function seedDemoData() {
  useChannelsStore.setState({ channels, loaded: true, error: null });
  usePostsStore.setState({ posts, loaded: true, error: null });
  useInboxStore.setState({
    conversations,
    loaded: true,
    error: null,
    messages: {
      v1: [msg("m1", "in", "Bonjour !", 15), msg("m2", "in", "Vous faites des gâteaux sur commande ?", 12)],
      v3: [msg("m3", "in", "Merci beaucoup, à samedi !", 600), msg("m4", "out", "Avec plaisir, à samedi !", 590)],
    },
  });
  useNotificationsStore.setState({
    loaded: true,
    error: null,
    items: [
      { id: "n1", type: "post_published", title: "Publication envoyée", body: "Votre publication est en ligne sur Facebook.", data: {}, createdAt: ago(30), unread: true },
      { id: "n2", type: "post_failed", title: "Échec de publication", body: "Instagram exige une image ou une vidéo.", data: {}, createdAt: ago(1500), unread: false },
    ],
  });
}
