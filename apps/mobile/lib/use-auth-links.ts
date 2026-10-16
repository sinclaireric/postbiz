import * as Linking from "expo-linking";
import { useEffect } from "react";

import { handleAuthLink } from "@/lib/auth-links";
import { useAuthStore } from "@/store/auth-store";

/** Écoute les liens `postbiz://auth-callback#…` (confirmation d'inscription, mot de passe oublié). */
export function useAuthLinks() {
  useEffect(() => {
    const handle = (url: string | null) => {
      void handleAuthLink(url).then((error) => {
        if (error) useAuthStore.getState().setLinkError(error);
      });
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, []);
}
