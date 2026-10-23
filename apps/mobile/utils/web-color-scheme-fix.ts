import { colorScheme } from "nativewind";
import { Platform } from "react-native";

// NativeWind 4 sur le web : en mode « media », son observateur de <head> appelle colorScheme.set() et lève une erreur
// qui bloque tout le rendu (écran blanc). L'application est claire par défaut et n'utilise aucun style `dark:` :
// on neutralise donc ce réglage manuel, sur le web seulement.
if (Platform.OS === "web") {
  (colorScheme as { set: (value: string) => void }).set = () => {};
}
