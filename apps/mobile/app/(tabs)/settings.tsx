import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MainTabNavbar } from "@/components/ui/main-tab-navbar";
import { NotificationBellButton } from "@/components/ui/notification-bell-button";
import { showToast } from "@/components/ui/toast";
import { getPushPermission, registerForPush, type PushStatus } from "@/lib/push";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore, type OrgRole } from "@/store/org-store";

const ROLE_LABEL: Record<OrgRole, string> = {
  admin: "Administrateur",
  member: "Membre",
  viewer: "Lecteur",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between rounded-[10px] bg-main-bg px-4 py-3">
      <Text className="font-jakarta text-body-1 text-text-secondary">{label}</Text>
      <Text className="ml-4 flex-1 text-right font-jakarta text-body-1 text-text-primary" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const org = useOrgStore((s) => s.current);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    void getPushPermission().then(setPush);
  }, []);

  const enablePush = async () => {
    if (!user) return;
    if (push === "denied") {
      // iOS et Android ne redemandent pas l'autorisation après un refus : il faut passer par les réglages du système.
      void Linking.openSettings();
      return;
    }
    const result = await registerForPush(user.id);
    setPush(result);
    if (result === "granted") showToast("Notifications activées", "success");
  };

  const pushLabel =
    push === "granted"
      ? "Activées"
      : push === "denied"
        ? "Désactivées dans le système"
        : push === "unsupported"
          ? "Indisponibles sur cet appareil"
          : "…";

  return (
    <SafeAreaView className="flex-1 bg-main-sections" edges={["top"]}>
      <StatusBar style="light" />

      <View className="h-[60px] flex-row items-center justify-between px-4">
        <Text className="font-jakarta text-h2 font-semibold text-text-primary">Réglages</Text>
        <NotificationBellButton />
      </View>

      <View className="flex-1 px-5 pt-4">
        <View className="w-full gap-5">
          <View className="gap-3">
            <Text className="font-jakarta text-h4 font-semibold text-text-primary">Compte</Text>
            <Row label="E-mail" value={user?.email ?? "—"} />
            <Row label="Organisation" value={org?.name ?? "—"} />
            <Row label="Rôle" value={org ? ROLE_LABEL[org.role] : "—"} />
          </View>

          <View className="gap-3">
            <Text className="font-jakarta text-h4 font-semibold text-text-primary">Notifications push</Text>
            <Row label="État" value={pushLabel} />
            {push === "denied" || push === "granted" ? (
              <Pressable
                className="h-[44px] w-full items-center justify-center rounded-[8px] bg-buttons-tertiary-bg"
                onPress={enablePush}
              >
                <Text className="font-jakarta text-[15px] font-semibold text-buttons-tertiary-text">
                  {push === "denied" ? "Ouvrir les réglages du système" : "Réenregistrer cet appareil"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            className="h-[52px] w-full items-center justify-center rounded-[8px] bg-buttons-primary-bg"
            onPress={() => setConfirmSignOut(true)}
          >
            <Text className="font-jakarta text-[16px] font-semibold text-buttons-primary-text">Se déconnecter</Text>
          </Pressable>

          <Text className="text-center font-jakarta text-caption text-text-secondary">
            Postbiz {Constants.expoConfig?.version ?? ""}
          </Text>
        </View>
      </View>

      <MainTabNavbar activeTab="settings" />

      <ConfirmDialog
        visible={confirmSignOut}
        title="Se déconnecter ?"
        message="Cet appareil ne recevra plus les notifications de ce compte."
        confirmLabel="Oui, me déconnecter"
        cancelLabel="Annuler"
        confirmDestructive
        onConfirm={() => {
          setConfirmSignOut(false);
          void useAuthStore.getState().signOut();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </SafeAreaView>
  );
}
