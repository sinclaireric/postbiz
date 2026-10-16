export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Sans projet Supabase configuré, l'app tourne en mode démo : données d'exemple, aucune connexion. */
export const isDemo = !supabaseUrl || !supabaseAnonKey;

export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
export const googleAuthEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE === '1';
