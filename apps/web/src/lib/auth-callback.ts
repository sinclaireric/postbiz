import type { MessageKey } from '@/i18n/types';

/** Page d'où part la connexion Google : on y revient, avec un message, si elle n'aboutit pas. */
export type AuthOrigin = 'login' | 'signup';
export const authOrigin = (value: string | null | undefined): AuthOrigin => (value === 'signup' ? 'signup' : 'login');

/** Codes `?erreur=` des écrans de connexion et d'inscription, et le message de chacun. */
export const AUTH_LINK_ERRORS = {
  lien: 'auth.linkErrors.lien',
  google: 'auth.linkErrors.google',
  annule: 'auth.linkErrors.annule',
  organisation: 'auth.linkErrors.organisation',
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
