import { describe, expect, it } from 'vitest';
import { AFTER_CONFIRMATION, authLinkErrorKey, authOrigin, callbackProblem, confirmFailure, confirmRequest, failureLocation } from './auth-callback';

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

describe('lien de confirmation par e-mail', () => {
  it('ouvre l’onboarding après la confirmation d’une inscription', () => {
    expect(confirmRequest(q('token_hash=abc123&type=email'))).toEqual({ tokenHash: 'abc123', type: 'email', next: AFTER_CONFIRMATION });
    expect(confirmRequest(q('token_hash=abc123&type=signup'))?.next).toBe(AFTER_CONFIRMATION);
    expect(AFTER_CONFIRMATION).toBe('/app/calendrier?onboarding=true');
  });
  it('renvoie une réinitialisation vers le nouveau mot de passe', () => {
    expect(confirmRequest(q('token_hash=abc&type=recovery'))?.next).toBe('/reset-password');
  });
  it('n’accepte qu’un chemin du site comme destination', () => {
    expect(confirmRequest(q('token_hash=abc&type=email&next=%2Fapp%2Finbox'))?.next).toBe('/app/inbox');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      expect(confirmRequest(new URLSearchParams({ token_hash: 'abc', type: 'email', next: bad }))?.next).toBe(AFTER_CONFIRMATION);
    }
  });
  it('refuse un lien incomplet ou d’un type inconnu', () => {
    for (const bad of ['', 'type=email', 'token_hash=abc', 'token_hash=abc&type=magiclink', 'token_hash=abc&type=invite', 'token_hash=&type=email', `token_hash=${'x'.repeat(513)}&type=email`]) {
      expect(confirmRequest(q(bad))).toBeNull();
    }
  });
  it('choisit le message selon le type de lien', () => {
    expect(confirmFailure('email')).toBe('confirmation');
    expect(confirmFailure('signup')).toBe('confirmation');
    expect(confirmFailure('recovery')).toBe('lien');
    expect(confirmFailure(undefined)).toBe('confirmation');
  });
});

