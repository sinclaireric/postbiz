import { describe, expect, it } from 'vitest';
import { authLinkErrorKey, authOrigin, callbackProblem, failureLocation } from './auth-callback';

const q = (s: string) => new URLSearchParams(s);

describe('retour de connexion (Google et liens e-mail)', () => {
  it('ne connaît que deux pages d’origine', () => {
    expect(authOrigin('signup')).toBe('signup');
    for (const other of ['login', '', null, undefined, 'https://evil.example', '/app']) expect(authOrigin(other)).toBe('login');
  });

  it('ne retient que les vrais codes d’erreur', () => {
    expect(authLinkErrorKey('annule')).toBe('auth.linkErrors.annule');
    expect(authLinkErrorKey('google')).toBe('auth.linkErrors.google');
    for (const other of [undefined, '', 'inconnu', 'toString', '__proto__', 'constructor']) expect(authLinkErrorKey(other)).toBeUndefined();
  });

  it('un refus sur l’écran Google est une annulation, pas une panne', () => {
    expect(callbackProblem(q('from=signup&error=access_denied&error_code=bad_oauth_callback'))).toBe('annule');
    expect(callbackProblem(q('from=login&error=server_error'))).toBe('google');
  });

  it('un lien e-mail refusé se lit comme un lien périmé', () => {
    expect(callbackProblem(q('error=access_denied&error_code=otp_expired'))).toBe('lien');
  });

  it('sans erreur signalée, il reste un code à échanger', () => {
    expect(callbackProblem(q('code=abc&next=%2Fapp&from=signup'))).toBeNull();
    expect(callbackProblem(q('code=abc'))).toBeNull();
  });

  it('renvoie l’utilisateur sur la page d’où il est parti', () => {
    expect(failureLocation(q('from=signup'), 'annule')).toBe('/signup?erreur=annule');
    expect(failureLocation(q('from=login'), 'google')).toBe('/login?erreur=google');
    expect(failureLocation(q('from=ailleurs'), 'google')).toBe('/login?erreur=google');
    expect(failureLocation(q('code=abc'), 'lien')).toBe('/login?erreur=lien');
  });
});
