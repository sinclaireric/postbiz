import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Field } from "@/components/ui/field";
import { PrimaryButton } from "@/components/ui/kit";
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
    <SafeAreaView className="absolute inset-0 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View className="flex-1 justify-center gap-6 px-6">
        {retryOnly ? (
          <>
            <Text className="font-jakarta text-[27px] font-semibold leading-[35px] text-ink">Chargement impossible</Text>
            <Text className="font-jakarta text-[14.5px] leading-[21px] text-ink-soft">Vos organisations n’ont pas pu être chargées. Vérifiez votre connexion.</Text>
            <PrimaryButton label="Réessayer" onPress={() => void useOrgStore.getState().load()} />
          </>
        ) : (
          <>
            <Text className="font-jakarta text-[27px] font-semibold leading-[35px] text-ink">Créez votre organisation</Text>
            <Text className="font-jakarta text-[14.5px] leading-[21px] text-ink-soft">Elle regroupe vos canaux, vos publications et votre boîte de réception.</Text>
            <Field
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
            <PrimaryButton label="Créer l’organisation" onPress={create} loading={busy} disabled={!name.trim()} />
          </>
        )}
        <Pressable className="h-[48px] items-center justify-center" onPress={() => void useAuthStore.getState().signOut()}>
          <Text className="font-jakarta text-[14.5px] font-semibold text-ink">Se déconnecter</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
