import { describe, expect, it } from 'vitest';
import { frenchAuthError, normalizeEmail, validateEmail, validatePassword } from './auth-validation';
import { safeNext } from './safe-redirect';

describe('validation des formulaires', () => {
  it('normalise l’e-mail', () => expect(normalizeEmail('  Léa@Exemple.FR ')).toBe('léa@exemple.fr'));
  it('valide les e-mails', () => {
    expect(validateEmail('a@b.co')).toBeNull();
    for (const bad of ['', 'a', 'a@b', 'a@b.', '@b.co', 'a b@c.fr']) expect(validateEmail(bad)).not.toBeNull();
  });
  it('exige 8 caractères minimum', () => {
    expect(validatePassword('1234567')).toMatch(/au moins 8/);
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('x'.repeat(73))).toMatch(/72/);
  });
  it('traduit les erreurs Supabase', () => {
    expect(frenchAuthError('Invalid login credentials')).toMatch(/incorrect/);
    expect(frenchAuthError('Email not confirmed')).toMatch(/Confirmez/);
    expect(frenchAuthError('quelque chose d’inattendu')).toMatch(/erreur/);
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
