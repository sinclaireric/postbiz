import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { ScrollView, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NETWORK_COLOR, NetworkGlyph } from "@/components/ui/brand-icon";
import { PageHeader } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { formatNetworkLabel } from "@/lib/networks";
import { useChannelsStore } from "@/store/channels-store";
import { useOrgStore } from "@/store/org-store";
import type { ChannelNetwork } from "@/types";

/** Adresse publique de l'application web : EXPO_PUBLIC_WEB_URL (ex. https://www.getpostbiz.com, sans « / » final). */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "").replace(/\/+$/, "");

const NETWORKS: { id: ChannelNetwork; hint: string }[] = [
  { id: "facebook", hint: "Page" },
  { id: "instagram", hint: "Compte professionnel" },
  { id: "x", hint: "Profil" },
  { id: "linkedin", hint: "Page ou profil" },
  { id: "tiktok", hint: "Compte professionnel ou personnel" },
  { id: "youtube", hint: "Chaîne" },
];

export default function AddChannelScreen() {
  const router = useRouter();

  // L'OAuth des réseaux se fait sur le site : on l'ouvre dans le navigateur intégré,
  // puis on recharge les canaux à la fermeture pour voir ceux qui viennent d'être ajoutés.
  const connect = async () => {
    if (!WEB_URL) {
      showToast("L’adresse du site n’est pas configurée.", "error");
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(`${WEB_URL}/app/canaux`);
    } catch {
      showToast("Impossible d’ouvrir le site.", "error");
      return;
    }
    const orgId = useOrgStore.getState().current?.id;
    if (orgId) await useChannelsStore.getState().load(orgId);
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />
      <PageHeader title="Connecter un nouveau canal" onBack={() => router.back()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ gap: 12, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {NETWORKS.map((n) => (
          <Pressable key={n.id} onPress={connect} accessibilityRole="button" className="flex-row items-center gap-4 rounded-[22px] border border-line bg-card p-4">
            <View className="h-[54px] w-[54px] items-center justify-center rounded-full" style={{ backgroundColor: NETWORK_COLOR[n.id] }}>
              <NetworkGlyph network={n.id} size={24} />
            </View>
            <View className="flex-1">
              <Text className="font-jakarta text-[15px] font-semibold text-ink">{formatNetworkLabel(n.id)}</Text>
              <Text className="font-jakarta text-[12.5px] text-ink-soft">{n.hint}</Text>
            </View>
            <Ionicons name="add" size={26} color="#2F4A00" />
          </Pressable>
        ))}
        <Text className="px-2 pt-2 font-jakarta text-[12px] leading-[17px] text-ink-soft">
          La connexion s’ouvre sur Postbiz web, car l’autorisation passe par chaque réseau. Connectez-vous avec le même compte, choisissez « Connecter », puis fermez la fenêtre pour revenir ici : vos canaux se mettent à jour.
        </Text>
        {!WEB_URL ? <Text className="px-2 font-jakarta text-[12px] text-text-critical">EXPO_PUBLIC_WEB_URL n’est pas configurée.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
