import type { MessageKey } from '@/i18n/types';
import type { FormError } from './form-error';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();

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

/** Messages d'erreur Supabase Auth ramenés à nos clés, sans révéler si une adresse existe déjà. */
export function authErrorKey(message: string | undefined): MessageKey {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'auth.errors.invalidCredentials';
  if (m.includes('email not confirmed')) return 'auth.errors.emailNotConfirmed';
  if (m.includes('rate limit') || m.includes('too many')) return 'auth.errors.rateLimit';
  if (m.includes('password should be') || m.includes('weak password')) return 'auth.errors.weakPassword';
  if (m.includes('same password')) return 'auth.errors.samePassword';
  return 'auth.errors.generic';
}
