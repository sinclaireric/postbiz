'use server';

import { redirect } from 'next/navigation';
import { authErrorKey, normalizeEmail, validateEmail, validatePassword } from '@/lib/auth-validation';
import type { FormError } from '@/lib/form-error';
import { getT } from '@/i18n/server';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safe-redirect';

export interface FormState {
  error?: string;
  message?: string;
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
  if (isDemo) return demoError();
  const email = normalizeEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const bad = validateEmail(email) ?? validatePassword(password) ?? (password !== confirm ? ({ key: 'auth.validation.passwordMismatch' } as FormError) : null);
  if (bad) return failure(bad);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent('/app/calendrier?onboarding=true')}` },
  });
  if (error) return failure({ key: authErrorKey(error.message) });
  if (data.session) redirect('/app/calendrier?onboarding=true'); // confirmation par e-mail désactivée côté Supabase
  const t = await getT();
  return { message: t('auth.messages.signupDone') };
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

export async function signInWithGoogle() {
  if (isDemo) redirect('/login');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${siteUrl}/auth/callback?next=/app` },
  });
  if (error || !data.url) redirect('/login?erreur=google');
  redirect(data.url);
}

export async function signOut() {
  if (!isDemo) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect('/');
}
