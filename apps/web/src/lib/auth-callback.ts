import type { MessageKey } from '@/i18n/types';
import { safeNext } from './safe-redirect';

/** Page d'où part la connexion Google : on y revient, avec un message, si elle n'aboutit pas. */
export type AuthOrigin = 'login' | 'signup';
export const authOrigin = (value: string | null | undefined): AuthOrigin => (value === 'signup' ? 'signup' : 'login');

/** Codes `?erreur=` des écrans de connexion et d'inscription, et le message de chacun. */
export const AUTH_LINK_ERRORS = {
  lien: 'auth.linkErrors.lien',
  google: 'auth.linkErrors.google',
  annule: 'auth.linkErrors.annule',
  confirmation: 'auth.linkErrors.confirmation',
  organisation: 'auth.linkErrors.organisation',
  suspendu: 'auth.errors.suspended',
} as const satisfies Record<string, MessageKey>;
export type AuthLinkError = keyof typeof AUTH_LINK_ERRORS;

/** Message d'un code `?erreur=` (ignore tout ce qui n'en est pas un : `toString`, `__proto__`…). */
export function authLinkErrorKey(code: string | undefined): MessageKey | undefined {
  return code && Object.hasOwn(AUTH_LINK_ERRORS, code) ? AUTH_LINK_ERRORS[code as AuthLinkError] : undefined;
}

/**
 * Seul le départ vers Google ajoute `from` au retour : un lien e-mail (confirmation, réinitialisation) n'en porte jamais,
 * et ses erreurs se lisent donc comme un lien périmé.
 */
export const isProviderReturn = (params: URLSearchParams) => params.has('from');

/** Problème signalé par Supabase ou Google dans l'adresse de retour (refus de l'utilisateur, lien expiré…). */
export function callbackProblem(params: URLSearchParams): AuthLinkError | null {
  if (!params.get('error')) return null;
  if (!isProviderReturn(params)) return 'lien';
  return params.get('error') === 'access_denied' ? 'annule' : 'google';
}

/** Où renvoyer l'utilisateur quand la connexion échoue : sur la page d'où il est parti (Google), sinon la connexion. */
export function failureLocation(params: URLSearchParams, code: AuthLinkError): string {
  const page = isProviderReturn(params) ? authOrigin(params.get('from')) : 'login';
  return `/${page}?erreur=${code}`;
}

/** Où va l'utilisateur une fois son adresse confirmée : directement à la configuration de son espace (comme sur Postiz). */
export const AFTER_CONFIRMATION = '/app/calendrier?onboarding=true';

/** Types de lien e-mail que /auth/confirm accepte : confirmation d'inscription (`email`, ou `signup` des anciens modèles) et réinitialisation. */
const CONFIRM_TYPES = ['email', 'signup', 'recovery'] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export interface ConfirmRequest {
  tokenHash: string;
  type: ConfirmType;
  next: string;
}

/**
 * Lit un lien de `/auth/confirm?token_hash=…&type=email` : le modèle d'e-mail Supabase le construit avec le jeton de
 * l'utilisateur. Contrairement au lien à code (PKCE), il se valide depuis n'importe quel appareil : on s'inscrit sur
 * l'ordinateur, on ouvre l'e-mail sur le téléphone. `next` ne peut être qu'un chemin du site.
 */
export function confirmRequest(params: URLSearchParams): ConfirmRequest | null {
  const tokenHash = params.get('token_hash')?.trim() ?? '';
  const type = CONFIRM_TYPES.find((candidate) => candidate === params.get('type'));
  if (!tokenHash || tokenHash.length > 512 || !type) return null;
  return { tokenHash, type, next: safeNext(params.get('next'), type === 'recovery' ? '/reset-password' : AFTER_CONFIRMATION) };
}

/** Message affiché quand un lien de confirmation échoue : une réinitialisation de mot de passe garde le message générique. */
export const confirmFailure = (type: ConfirmType | undefined): AuthLinkError => (type === 'recovery' ? 'lien' : 'confirmation');

/** Cookie qui garde l'adresse de l'inscription le temps de l'écran « Vérifiez votre boîte mail » (pas d'adresse dans l'URL). */
export const SIGNUP_EMAIL_COOKIE = 'pb-signup-email';
export const SIGNUP_EMAIL_MAX_AGE = 60 * 60;
/** Délai avant de pouvoir demander un nouvel e-mail (Supabase en accepte un par minute et par adresse). */
export const RESEND_COOLDOWN_SECONDS = 60;
