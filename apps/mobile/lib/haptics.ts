import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// Retours haptiques discrets : léger pour un bouton, « sélection » pour un choix (onglet, jour, case), plus marqué pour une action
// importante, et les trois notifications système (réussite, avertissement, erreur). Sans effet sur le web ; jamais d'erreur remontée.

const enabled = Platform.OS !== "web";
const run = (fn: () => Promise<void>) => {
  if (enabled) void fn().catch(() => undefined);
};

export const haptic = {
  /** Bouton ordinaire. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Action importante (nouvelle publication, appui long). */
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Changement de choix : onglet, jour, case à cocher, segment. */
  select: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
