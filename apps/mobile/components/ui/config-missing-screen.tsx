import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Affiché quand l'app est lancée sans les variables Supabase : on dit précisément quoi faire. */
export function ConfigMissingScreen() {
  return (
    <SafeAreaView className="absolute inset-0 bg-canvas" edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View className="flex-1 justify-center gap-4 px-6">
        <Text className="font-jakarta text-[32px] font-semibold leading-[40px] text-ink">Configuration manquante</Text>
        <Text className="font-jakarta text-[16px] leading-[24px] text-ink-soft">Postbiz a besoin de votre projet Supabase. Créez un fichier .env dans apps/mobile avec :</Text>
        <View className="rounded-[18px] border border-line bg-card p-4">
          <Text className="font-jakarta text-[13px] text-ink">EXPO_PUBLIC_SUPABASE_URL=https://…supabase.co</Text>
          <Text className="font-jakarta text-[13px] text-ink">EXPO_PUBLIC_SUPABASE_ANON_KEY=…</Text>
        </View>
        <Text className="font-jakarta text-[16px] leading-[24px] text-ink-soft">Puis relancez avec « npx expo start -c ». Voir le README d’apps/mobile.</Text>
      </View>
    </SafeAreaView>
  );
}
