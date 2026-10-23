import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Petites préférences locales (drapeaux « déjà vu »). Jamais de donnée sensible ici.

export async function getPref(key: string): Promise<string | null> {
  try {
    return Platform.OS === "web" ? (globalThis.localStorage?.getItem(key) ?? null) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setPref(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Sans stockage, l'écran sera simplement proposé à nouveau : sans gravité.
  }
}
