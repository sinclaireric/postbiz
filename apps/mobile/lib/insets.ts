import { Dimensions, Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Marges de sécurité de l'écran. Sur certains écrans présentés par la navigation native (modales), iOS peut rapporter
 * 0 en haut : l'en-tête se retrouve alors sous l'encoche et ses boutons ne sont plus touchables. Dans ce cas on
 * retombe sur la hauteur habituelle de la barre d'état.
 */
export function useScreenInsets(): { top: number; bottom: number } {
  const { top, bottom } = useSafeAreaInsets();
  if (top > 0 || Platform.OS === "web") return { top, bottom };
  if (Platform.OS === "android") return { top: StatusBar.currentHeight ?? 24, bottom };
  return { top: Dimensions.get("window").height >= 812 ? 54 : 20, bottom };
}
