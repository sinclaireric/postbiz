'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AFTER_CONFIRMATION, authOrigin, SIGNUP_EMAIL_COOKIE, SIGNUP_EMAIL_MAX_AGE } from '@/lib/auth-callback';
import { authErrorKey, normalizeCompany, normalizeEmail, validateCompany, validateEmail, validatePassword } from '@/lib/auth-validation';
import type { FormError } from '@/lib/form-error';
import { getLocale, getT } from '@/i18n/server';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safe-redirect';

export interface FormState {
  error?: string;
  message?: string;
  /** Champs à remettre dans le formulaire : React 19 vide les champs après chaque envoi, y compris refusé. */
  values?: { email?: string; company?: string };
}

async function failure(e: FormError): Promise<FormState> {
  const t = await getT();
  return { error: t(e.key, e.params) };
}

async function demoError(): Promise<FormState> {
  const t = await getT();
  return { error: t('auth.messages.demo') };
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return demoError();
  const email = normalizeEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  const bad = validateEmail(email) ?? (password ? null : ({ key: 'auth.validation.passwordCurrentRequired' } as FormError));
  if (bad) return failure(bad);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return failure({ key: authErrorKey(error.message) });
  redirect(safeNext(String(formData.get('next') ?? '')));
}

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const email = normalizeEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  const company = normalizeCompany(formData.get('company'));
  // Refusé, le formulaire garde l'e-mail et l'entreprise (jamais le mot de passe).
  const refused = async (e: FormError): Promise<FormState> => ({ ...(await failure(e)), values: { email, company } });

  if (isDemo) return { ...(await demoError()), values: { email, company } };
  const bad = validateEmail(email) ?? validatePassword(password) ?? validateCompany(company);
  if (bad) return refused(bad);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // `company` nomme l'espace de travail, créé à la première arrivée dans l'app (comme sur mobile). `source` et `locale`
      // servent au modèle d'e-mail Supabase : lien de confirmation du site, dans la langue de l'inscription.
      data: { company, locale: await getLocale(), source: 'web' },
      // Repli pour un modèle d'e-mail resté par défaut : lien à code, valable dans le navigateur de l'inscription.
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(AFTER_CONFIRMATION)}`,
    },
  });
  if (error) return refused({ key: authErrorKey(error.message) });
  if (data.session) redirect(AFTER_CONFIRMATION); // confirmation par e-mail désactivée côté Supabase

  // Compte créé, adresse à confirmer : écran « Vérifiez votre boîte mail ». L'adresse y est gardée dans un cookie plutôt que dans l'URL.
  (await cookies()).set(SIGNUP_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SIGNUP_EMAIL_MAX_AGE,
    path: '/signup',
  });
  redirect('/signup/verification');
}

/** « Renvoyer l'e-mail » de l'écran de vérification : même lien, pour l'adresse de l'inscription en cours. */
export async function resendConfirmation(): Promise<FormState> {
  if (isDemo) return demoError();
  const email = (await cookies()).get(SIGNUP_EMAIL_COOKIE)?.value ?? '';
  if (validateEmail(email)) redirect('/signup');
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(AFTER_CONFIRMATION)}` },
  });
  if (error) return failure({ key: authErrorKey(error.message) });
  const t = await getT();
  return { message: t('auth.verify.resent') };
}

export async function forgotPassword(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return demoError();
  const email = normalizeEmail(formData.get('email'));
  const bad = validateEmail(email);
  if (bad) return failure(bad);
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/auth/callback?next=/reset-password` });
  // Même réponse que l'adresse existe ou non
  const t = await getT();
  return { message: t('auth.messages.forgotDone') };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return demoError();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const bad = validatePassword(password) ?? (password !== confirm ? ({ key: 'auth.validation.passwordMismatch' } as FormError) : null);
  if (bad) return failure(bad);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return failure({ key: authErrorKey(error.message) });
  redirect('/app');
}

/**
 * Connexion et inscription avec Google : Supabase Auth porte tout le protocole (état anti-CSRF, PKCE, échange du code).
 * L'utilisateur part sur Google, revient sur Supabase, puis sur /auth/callback qui ouvre la session. Le même parcours sert
 * à créer le compte : un nouvel utilisateur est créé à son premier passage, puis l'espace de travail à l'arrivée dans l'app.
 */
export async function signInWithGoogle(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return demoError();
  const from = authOrigin(String(formData.get('from') ?? ''));
  const next = safeNext(String(formData.get('next') ?? ''));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Adresse à déclarer dans Supabase > Authentication > URL Configuration (Redirect URLs : `${siteUrl}/**`).
      redirectTo: `${siteUrl}/auth/callback?${new URLSearchParams({ next, from })}`,
      // Propose le choix du compte Google plutôt que de reprendre silencieusement celui déjà ouvert.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error || !data.url) return failure({ key: 'auth.linkErrors.google' });
  redirect(data.url);
}

export async function signOut() {
  if (!isDemo) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect('/');
}
