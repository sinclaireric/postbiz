import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Affiché quand l'app est lancée sans les variables Supabase : on dit précisément quoi faire. */
export function ConfigMissingScreen() {
  return (
    <SafeAreaView className="absolute inset-0 bg-background-primary" edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <View className="flex-1 justify-center gap-4 px-6">
        <Text className="font-jakarta text-h1 font-semibold text-text-primary">Configuration manquante</Text>
        <Text className="font-jakarta text-body-1 text-text-secondary">
          Postbiz a besoin de votre projet Supabase. Créez un fichier .env dans apps/mobile avec :
        </Text>
        <View className="rounded-[8px] bg-main-sections-2 p-3">
          <Text className="font-jakarta text-body-2 text-text-primary">EXPO_PUBLIC_SUPABASE_URL=https://…supabase.co</Text>
          <Text className="font-jakarta text-body-2 text-text-primary">EXPO_PUBLIC_SUPABASE_ANON_KEY=…</Text>
        </View>
        <Text className="font-jakarta text-body-1 text-text-secondary">
          Puis relancez avec « npx expo start -c ». Voir le README d’apps/mobile.
        </Text>
      </View>
    </SafeAreaView>
  );
}
