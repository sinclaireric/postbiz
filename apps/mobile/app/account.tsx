import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Field, PasswordField } from "@/components/ui/field";
import { PageHeader, PrimaryButton, Row, Sheet } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { getPushPermission, registerForPush, type PushStatus } from "@/lib/push";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore, type OrgRole } from "@/store/org-store";

const ROLE: Record<OrgRole, string> = { admin: "Administrateur", member: "Membre", viewer: "Lecteur" };

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 font-jakarta text-[18px] font-semibold text-ink">{title}</Text>
      <View className="overflow-hidden rounded-[22px] bg-card">{children}</View>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const org = useOrgStore((s) => s.current);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwError, setPwError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushPermission().then(setPush);
  }, []);

  const pushValue = push === "granted" ? "Activées" : push === "denied" ? "Désactivées" : push === "undetermined" ? "Non activées" : push === "unsupported" ? "Indisponibles ici" : "…";

  const togglePush = async () => {
    if (!user || push === "unsupported") return;
    if (push === "denied") {
      // Après un refus, iOS et Android ne redemandent plus : il faut passer par les réglages du système.
      void Linking.openSettings();
      return;
    }
    const result = await registerForPush(user.id);
    setPush(result);
    if (result === "granted") showToast("Notifications activées", "success");
  };

  const changePassword = async () => {
    if (pw.length < 8) return setPwError("8 caractères minimum");
    if (pw !== pw2) return setPwError("Les mots de passe ne correspondent pas");
    setBusy(true);
    const result = await useAuthStore.getState().updatePassword(pw);
    setBusy(false);
    if (!result.ok) return setPwError(result.error);
    setPwOpen(false);
    setPw("");
    setPw2("");
    showToast("Mot de passe modifié", "success");
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <StatusBar style="dark" />
      <PageHeader title="Paramètres du compte" onBack={() => router.back()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ gap: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Group title="Compte">
          <Row icon="notifications-outline" label="Notifications push" value={pushValue} onPress={togglePush} />
          <Row icon="at-outline" label="E-mail" value={user?.email ?? "—"} chevron={false} />
          <Row icon="key-outline" label="Changer le mot de passe" onPress={() => setPwOpen(true)} />
          <Row icon="add-circle-outline" label="Ajouter un nouveau canal" onPress={() => router.push("/add-channel")} />
          <Row icon="share-social-outline" label="Canaux" onPress={() => router.push("/channels")} />
          <Row icon="images-outline" label="Médias" onPress={() => router.push("/media")} last />
        </Group>

        <Group title="Organisation">
          <Row icon="business-outline" label="Nom" value={org?.name ?? "—"} chevron={false} />
          <Row icon="shield-checkmark-outline" label="Rôle" value={org ? ROLE[org.role] : "—"} chevron={false} last />
        </Group>

        <Group title="À propos">
          <Row icon="document-text-outline" label="Conditions d’utilisation" onPress={() => WebBrowser.openBrowserAsync("https://www.getpostbiz.com/cgu")} />
          <Row icon="lock-closed-outline" label="Politique de confidentialité" onPress={() => WebBrowser.openBrowserAsync("https://www.getpostbiz.com/confidentialite")} />
          <Row icon="information-circle-outline" label="Version" value={Constants.expoConfig?.version ?? ""} chevron={false} last />
        </Group>

        <View className="overflow-hidden rounded-[22px] bg-card">
          <Row icon="log-out-outline" label="Se déconnecter" danger last onPress={() => void useAuthStore.getState().signOut()} chevron={false} />
        </View>
      </ScrollView>

      <Sheet visible={pwOpen} onClose={() => setPwOpen(false)} title="Mot de passe">
        <View className="gap-4 pb-2">
          <PasswordField label="Nouveau mot de passe" value={pw} onChangeText={(t) => { setPw(t); setPwError(undefined); }} placeholder="8 caractères minimum" />
          <PasswordField label="Confirmation" value={pw2} onChangeText={(t) => { setPw2(t); setPwError(undefined); }} placeholder="Confirmez le mot de passe" error={!!pwError} hint={pwError} />
          <PrimaryButton label="Enregistrer" onPress={changePassword} loading={busy} />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
