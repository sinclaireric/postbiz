/**
 * Mode démo local (développement uniquement) : `EXPO_PUBLIC_DEMO=1 npx expo start --web`.
 * Remplit les stores avec des données d'exemple, sans compte ni Supabase, pour vérifier l'interface.
 * Si la variable est absente (cas normal, et build de production), tout ce code est inerte.
 */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
