import type { MessageKey } from '@/i18n/types';
import type { FormError } from './form-error';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
/** Longueur max du nom de l'entreprise (celle du nom d'organisation en base : ensure_organization tronque à 120). */
export const MAX_COMPANY_LENGTH = 120;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();
/** Nom d'entreprise tel qu'on le garde : espaces superflus retirés. */
export const normalizeCompany = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function validateEmail(email: string): FormError | null {
  if (!email) return { key: 'auth.validation.emailRequired' };
  if (!EMAIL_RE.test(email) || email.length > 254) return { key: 'auth.validation.emailInvalid' };
  return null;
}

export function validatePassword(password: string): FormError | null {
  if (!password) return { key: 'auth.validation.passwordRequired' };
  if (password.length < MIN_PASSWORD_LENGTH) return { key: 'auth.validation.passwordShort', params: { min: MIN_PASSWORD_LENGTH } };
  if (password.length > MAX_PASSWORD_LENGTH) return { key: 'auth.validation.passwordLong', params: { max: MAX_PASSWORD_LENGTH } };
  return null;
}

export function validateCompany(company: string): FormError | null {
  if (!company) return { key: 'auth.validation.companyRequired' };
  if ([...company].length > MAX_COMPANY_LENGTH) return { key: 'auth.validation.companyLong', params: { max: MAX_COMPANY_LENGTH } };
  return null;
}

/** Messages d'erreur Supabase Auth ramenés à nos clés, sans révéler si une adresse existe déjà. */
export function authErrorKey(message: string | undefined): MessageKey {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'auth.errors.invalidCredentials';
  if (m.includes('email not confirmed')) return 'auth.errors.emailNotConfirmed';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) return 'auth.errors.rateLimit';
  if (m.includes('password should be') || m.includes('weak password')) return 'auth.errors.weakPassword';
  if (m.includes('same password')) return 'auth.errors.samePassword';
  if (m.includes('banned')) return 'auth.errors.suspended';
  return 'auth.errors.generic';
}
