import { describe, expect, it } from 'vitest';
import { authErrorKey, normalizeEmail, validateEmail, validatePassword } from './auth-validation';
import { safeNext } from './safe-redirect';

describe('validation des formulaires', () => {
  it('normalise l’e-mail', () => expect(normalizeEmail('  Léa@Exemple.FR ')).toBe('léa@exemple.fr'));
  it('valide les e-mails', () => {
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('')).toEqual({ key: 'auth.validation.emailRequired' });
    for (const bad of ['a', 'a@b', 'a@b.', '@b.co', 'a b@c.fr']) expect(validateEmail(bad)).toEqual({ key: 'auth.validation.emailInvalid' });
  });
  it('exige 8 caractères minimum et 72 au maximum', () => {
    expect(validatePassword('1234567')).toEqual({ key: 'auth.validation.passwordShort', params: { min: 8 } });
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('x'.repeat(73))).toEqual({ key: 'auth.validation.passwordLong', params: { max: 72 } });
    expect(validatePassword('')).toEqual({ key: 'auth.validation.passwordRequired' });
  });
  it('ramène les erreurs Supabase à nos clés', () => {
    expect(authErrorKey('Invalid login credentials')).toBe('auth.errors.invalidCredentials');
    expect(authErrorKey('Email not confirmed')).toBe('auth.errors.emailNotConfirmed');
    expect(authErrorKey('quelque chose d’inattendu')).toBe('auth.errors.generic');
    expect(authErrorKey(undefined)).toBe('auth.errors.generic');
  });
});

describe('safeNext', () => {
  it('accepte les chemins internes', () => expect(safeNext('/app/inbox?c=1')).toBe('/app/inbox?c=1'));
  it('refuse les URL externes et les astuces de redirection', () => {
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/ok\n/x', '']) {
      expect(safeNext(bad)).toBe('/app');
    }
    expect(safeNext(null, '/x')).toBe('/x');
  });
});
