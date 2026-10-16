import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { AuthInput } from "@/components/ui/auth-input";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";

/**
 * Compte sans organisation (inscription sans nom d'entreprise, ou invitation pas encore acceptée) : on en crée une.
 * Avec `retryOnly`, le chargement des organisations a échoué : on propose seulement de réessayer.
 */
export function CreateOrganizationScreen({ retryOnly = false }: { retryOnly?: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const result = await useOrgStore.getState().createOrganization(name);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <SafeAreaView className="absolute inset-0 bg-background-primary" edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <View className="flex-1 justify-center gap-6 px-5">
        {retryOnly ? (
          <>
            <Text className="font-jakarta text-h1 font-semibold text-text-primary">Chargement impossible</Text>
            <Text className="font-jakarta text-body-1 text-text-secondary">
              Vos organisations n’ont pas pu être chargées. Vérifiez votre connexion.
            </Text>
            <AppButton label="Réessayer" onPress={() => void useOrgStore.getState().load()} />
          </>
        ) : (
          <>
            <Text className="font-jakarta text-h1 font-semibold text-text-primary">Créez votre organisation</Text>
            <Text className="font-jakarta text-body-1 text-text-secondary">
              Elle regroupe vos canaux, vos publications et votre boîte de réception.
            </Text>
            <AuthInput
              label="Nom de l’organisation"
              value={name}
              onChangeText={(t) => {
                setName(t);
                setError(undefined);
              }}
              placeholder="Ex. Boulangerie Martin"
              autoCapitalize="words"
              error={!!error}
              hint={error}
            />
            <AppButton
              label={busy ? "Création…" : "Créer l’organisation"}
              variant={name.trim() && !busy ? "primary" : "disabled"}
              disabled={!name.trim() || busy}
              onPress={create}
            />
          </>
        )}
        <AppButton label="Se déconnecter" variant="text" onPress={() => void useAuthStore.getState().signOut()} />
      </View>
    </SafeAreaView>
  );
}
