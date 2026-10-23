import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Text, View } from "react-native";

import { Image } from "@/components/ui/image";
import type { ChannelNetwork } from "@/types";

// Aperçu qui imite l'apparence d'une publication sur chaque réseau. Ce n'est pas un rendu exact (les réseaux changent
// souvent leur interface) : il donne le bon ordre des éléments, les bonnes couleurs et la mise en forme du texte.
// Les médias ne sont pas encore pris en charge : seul le texte est montré.

export type PreviewProps = {
  network: ChannelNetwork;
  /** Nom du compte (Page, profil, chaîne). */
  name: string;
  username?: string | null;
  avatar?: string;
  /** Textes bruts : le premier est la publication, les suivants forment un fil. */
  thread: string[];
  /** Date de publication, ISO. */
  date: string;
};

const URL_OR_TAG = /(https?:\/\/\S+|#[A-Za-zÀ-ÿ0-9_]+|@[A-Za-zÀ-ÿ0-9_.]+)/g;

/** Texte avec liens, #hashtags et @mentions colorés comme sur le réseau. */
function RichText({ text, color, linkColor, size = 15, lineHeight = 21, numberOfLines }: {
  text: string;
  color: string;
  linkColor: string;
  size?: number;
  lineHeight?: number;
  numberOfLines?: number;
}) {
  const parts = text.split(URL_OR_TAG);
  return (
    <Text style={{ color, fontSize: size, lineHeight }} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={{ color: linkColor }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function Avatar({ uri, name, size, round = true, bg = "#D0D0D6" }: { uri?: string; name: string; size: number; round?: boolean; bg?: string }) {
  const radius = round ? size / 2 : 6;
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} contentFit="cover" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: size * 0.42 }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

const when = (iso: string, pattern: string) => format(parseISO(iso), pattern, { locale: fr });

function NoMedia({ height = 220 }: { height?: number }) {
  return (
    <View style={{ height, backgroundColor: "#E9E9EE", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <Ionicons name="image-outline" size={34} color="#9A9AA0" />
      <Text style={{ color: "#6B6B70", fontSize: 12 }}>Aucun média (bientôt disponible)</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Facebook */
function FacebookPreview({ name, avatar, thread, date }: PreviewProps) {
  return (
    <View style={{ gap: 10 }}>
      {thread.map((text, i) => (
        <View key={i} style={{ backgroundColor: "#FFFFFF", borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#E4E6EB" }}>
          <View style={{ flexDirection: "row", gap: 8, padding: 12, alignItems: "center" }}>
            <Avatar uri={avatar} name={name} size={40} bg="#1877F2" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#050505", fontSize: 15, fontWeight: "600" }} numberOfLines={1}>{name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#65676B", fontSize: 13 }}>{when(date, "d MMMM 'à' HH:mm")}</Text>
                <Text style={{ color: "#65676B", fontSize: 13 }}>·</Text>
                <Ionicons name="earth" size={12} color="#65676B" />
              </View>
            </View>
            <Ionicons name="ellipsis-horizontal" size={20} color="#65676B" />
          </View>
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <RichText text={text} color="#050505" linkColor="#216FDB" size={15} lineHeight={20} />
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: "#E4E6EB", flexDirection: "row", justifyContent: "space-around", paddingVertical: 10 }}>
            {[
              ["thumbs-up-outline", "J’aime"],
              ["chatbubble-outline", "Commenter"],
              ["arrow-redo-outline", "Partager"],
            ].map(([icon, label]) => (
              <View key={label} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Ionicons name={icon as "thumbs-up-outline"} size={18} color="#65676B" />
                <Text style={{ color: "#65676B", fontSize: 14, fontWeight: "600" }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- Instagram */
function InstagramPreview({ name, username, avatar, thread, date }: PreviewProps) {
  const handle = username || name.toLowerCase().replace(/\s+/g, "");
  return (
    <View style={{ gap: 10 }}>
      <View style={{ backgroundColor: "#FFFFFF", borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#DBDBDB" }}>
        <View style={{ flexDirection: "row", gap: 10, padding: 10, alignItems: "center" }}>
          <View style={{ padding: 2, borderRadius: 20, borderWidth: 2, borderColor: "#E1306C" }}>
            <Avatar uri={avatar} name={name} size={30} bg="#C13584" />
          </View>
          <Text style={{ flex: 1, color: "#262626", fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{handle}</Text>
          <Ionicons name="ellipsis-horizontal" size={20} color="#262626" />
        </View>
        <NoMedia height={280} />
        <View style={{ flexDirection: "row", padding: 10, gap: 14, alignItems: "center" }}>
          <Ionicons name="heart-outline" size={26} color="#262626" />
          <Ionicons name="chatbubble-outline" size={24} color="#262626" />
          <Ionicons name="paper-plane-outline" size={24} color="#262626" />
          <View style={{ flex: 1 }} />
          <Ionicons name="bookmark-outline" size={24} color="#262626" />
        </View>
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 4 }}>
          <Text style={{ color: "#262626", fontSize: 14, lineHeight: 19 }}>
            <Text style={{ fontWeight: "600" }}>{handle} </Text>
            {thread[0].split(URL_OR_TAG).map((part, i) =>
              i % 2 === 1 ? <Text key={i} style={{ color: "#00376B" }}>{part}</Text> : part,
            )}
          </Text>
          <Text style={{ color: "#8E8E8E", fontSize: 10, letterSpacing: 0.4 }}>{when(date, "d MMMM yyyy").toUpperCase()}</Text>
        </View>
      </View>
      {thread.length > 1 ? (
        <Text style={{ color: "#6B6B70", fontSize: 12 }}>
          Instagram n’affiche pas les fils : seul le premier message est publié.
        </Text>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- X */
function XPreview({ name, username, avatar, thread, date }: PreviewProps) {
  const handle = username || name.toLowerCase().replace(/\s+/g, "");
  return (
    <View style={{ backgroundColor: "#FFFFFF", borderRadius: 8, borderWidth: 1, borderColor: "#EFF3F4", paddingHorizontal: 12, paddingTop: 12 }}>
      {thread.map((text, i) => {
        const last = i === thread.length - 1;
        return (
          <View key={i} style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ alignItems: "center" }}>
              <Avatar uri={avatar} name={name} size={40} bg="#0F1419" />
              {!last ? <View style={{ flex: 1, width: 2, backgroundColor: "#CFD9DE", marginTop: 4 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 12 : 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#0F1419", fontSize: 15, fontWeight: "700", flexShrink: 1 }} numberOfLines={1}>{name}</Text>
                <Text style={{ color: "#536471", fontSize: 15, flexShrink: 1 }} numberOfLines={1}>@{handle}</Text>
                <Text style={{ color: "#536471", fontSize: 15 }}>· {when(date, "d MMM")}</Text>
              </View>
              <RichText text={text} color="#0F1419" linkColor="#1D9BF0" size={15} lineHeight={20} />
              <Text style={{ color: text.length > 280 ? "#D92D20" : "#536471", fontSize: 12, marginTop: 4 }}>
                {text.length} / 280 caractères
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingRight: 30 }}>
                {["chatbubble-outline", "repeat-outline", "heart-outline", "stats-chart-outline", "share-outline"].map((icon) => (
                  <Ionicons key={icon} name={icon as "heart-outline"} size={18} color="#536471" />
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ---------------------------------------------------------------- LinkedIn */
function LinkedInPreview({ name, avatar, thread, date }: PreviewProps) {
  return (
    <View style={{ backgroundColor: "#FFFFFF", borderRadius: 8, borderWidth: 1, borderColor: "#E0DFDC", overflow: "hidden" }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
        <Avatar uri={avatar} name={name} size={48} round={false} bg="#0A66C2" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "rgba(0,0,0,0.9)", fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{name}</Text>
          <Text style={{ color: "rgba(0,0,0,0.6)", fontSize: 12 }}>Abonnés</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ color: "rgba(0,0,0,0.6)", fontSize: 12 }}>{when(date, "d MMM")} •</Text>
            <Ionicons name="earth" size={12} color="rgba(0,0,0,0.6)" />
          </View>
        </View>
        <Ionicons name="ellipsis-horizontal" size={20} color="rgba(0,0,0,0.6)" />
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
        {thread.map((text, i) => (
          <RichText key={i} text={text} color="rgba(0,0,0,0.9)" linkColor="#0A66C2" size={14} lineHeight={20} />
        ))}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: "#E0DFDC", flexDirection: "row", justifyContent: "space-around", paddingVertical: 10 }}>
        {[
          ["thumbs-up-outline", "J’aime"],
          ["chatbubble-ellipses-outline", "Commenter"],
          ["repeat-outline", "Republier"],
          ["send-outline", "Envoyer"],
        ].map(([icon, label]) => (
          <View key={label} style={{ alignItems: "center", gap: 2 }}>
            <Ionicons name={icon as "send-outline"} size={20} color="rgba(0,0,0,0.6)" />
            <Text style={{ color: "rgba(0,0,0,0.6)", fontSize: 12, fontWeight: "600" }}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- TikTok */
function TikTokPreview({ name, username, avatar, thread }: PreviewProps) {
  const handle = username || name.toLowerCase().replace(/\s+/g, "");
  return (
    <View style={{ backgroundColor: "#000000", borderRadius: 12, overflow: "hidden", height: 460 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Ionicons name="videocam-outline" size={38} color="#FFFFFF66" />
        <Text style={{ color: "#FFFFFF99", fontSize: 12 }}>Vidéo requise (bientôt disponible)</Text>
      </View>
      <View style={{ position: "absolute", right: 10, bottom: 70, alignItems: "center", gap: 18 }}>
        <Avatar uri={avatar} name={name} size={42} bg="#FE2C55" />
        {[
          ["heart", "—"],
          ["chatbubble-ellipses", "—"],
          ["bookmark", "—"],
          ["arrow-redo", "—"],
        ].map(([icon, label]) => (
          <View key={icon} style={{ alignItems: "center" }}>
            <Ionicons name={icon as "heart"} size={30} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: 11 }}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ position: "absolute", left: 12, right: 70, bottom: 14, gap: 6 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>@{handle}</Text>
        <RichText text={thread[0]} color="#FFFFFF" linkColor="#FFFFFF" size={14} lineHeight={19} numberOfLines={4} />
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Ionicons name="musical-notes" size={13} color="#FFFFFF" />
          <Text style={{ color: "#FFFFFF", fontSize: 12 }}>Son original · {name}</Text>
        </View>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- YouTube */
function YouTubePreview({ name, avatar, thread, date }: PreviewProps) {
  return (
    <View style={{ backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#E5E5E5", padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Avatar uri={avatar} name={name} size={40} bg="#FF0000" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#0F0F0F", fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{name}</Text>
          <Text style={{ color: "#606060", fontSize: 12 }}>{when(date, "d MMMM yyyy")} · Publication de la communauté</Text>
        </View>
        <Ionicons name="ellipsis-vertical" size={18} color="#0F0F0F" />
      </View>
      {thread.map((text, i) => (
        <RichText key={i} text={text} color="#0F0F0F" linkColor="#065FD4" size={14} lineHeight={20} />
      ))}
      <View style={{ flexDirection: "row", gap: 22, alignItems: "center" }}>
        <Ionicons name="thumbs-up-outline" size={20} color="#0F0F0F" />
        <Ionicons name="thumbs-down-outline" size={20} color="#0F0F0F" />
        <Ionicons name="chatbubble-outline" size={20} color="#0F0F0F" />
      </View>
    </View>
  );
}

/** Repli pour les réseaux sans mise en page dédiée. */
function GenericPreview({ name, avatar, thread, date }: PreviewProps) {
  return (
    <View style={{ backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#E6E6EA", padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Avatar uri={avatar} name={name} size={36} />
        <View>
          <Text style={{ color: "#111111", fontWeight: "600" }}>{name}</Text>
          <Text style={{ color: "#6B6B70", fontSize: 12 }}>{when(date, "d MMMM yyyy 'à' HH:mm")}</Text>
        </View>
      </View>
      {thread.map((text, i) => (
        <RichText key={i} text={text} color="#111111" linkColor="#3B64F6" />
      ))}
    </View>
  );
}

export function PostPreview(props: PreviewProps) {
  const thread = props.thread.length > 0 ? props.thread : [""];
  const p = { ...props, thread };
  switch (props.network) {
    case "facebook":
      return <FacebookPreview {...p} />;
    case "instagram":
    case "instagram-business":
      return <InstagramPreview {...p} />;
    case "x":
      return <XPreview {...p} />;
    case "linkedin":
    case "linkedin-page":
      return <LinkedInPreview {...p} />;
    case "tiktok":
      return <TikTokPreview {...p} />;
    case "youtube":
      return <YouTubePreview {...p} />;
    default:
      return <GenericPreview {...p} />;
  }
}
