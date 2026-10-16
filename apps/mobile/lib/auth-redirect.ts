import * as Linking from "expo-linking";

/**
 * URL de retour des e-mails Supabase (confirmation d'inscription, réinitialisation du mot de passe).
 * À autoriser dans Supabase → Authentication → URL Configuration → Redirect URLs (`postbiz://**`, et `exp://**` en développement).
 */
export const AUTH_REDIRECT_URL = Linking.createURL("auth-callback");
