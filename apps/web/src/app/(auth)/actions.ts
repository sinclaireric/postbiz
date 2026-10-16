'use server';

import { redirect } from 'next/navigation';
import { frenchAuthError, normalizeEmail, validateEmail, validatePassword } from '@/lib/auth-validation';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safe-redirect';

export interface FormState {
  error?: string;
  message?: string;
}

const DEMO_ERROR: FormState = { error: 'Mode démo : Supabase n’est pas configuré. Renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.' };

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return DEMO_ERROR;
  const email = normalizeEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  const bad = validateEmail(email) ?? (password ? null : 'Saisissez votre mot de passe.');
  if (bad) return { error: bad };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: frenchAuthError(error.message) };
  redirect(safeNext(String(formData.get('next') ?? '')));
}

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return DEMO_ERROR;
  const email = normalizeEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const bad = validateEmail(email) ?? validatePassword(password) ?? (password !== confirm ? 'Les deux mots de passe ne correspondent pas.' : null);
  if (bad) return { error: bad };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=/app/onboarding` },
  });
  if (error) return { error: frenchAuthError(error.message) };
  if (data.session) redirect('/app/onboarding'); // confirmation par e-mail désactivée côté Supabase
  return { message: 'Compte créé. Ouvrez le lien que nous venons de vous envoyer par e-mail pour confirmer votre adresse.' };
}

export async function forgotPassword(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return DEMO_ERROR;
  const email = normalizeEmail(formData.get('email'));
  const bad = validateEmail(email);
  if (bad) return { error: bad };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/auth/callback?next=/reset-password` });
  // Même réponse que l'adresse existe ou non
  return { message: 'Si un compte existe pour cette adresse, un lien de réinitialisation vient de lui être envoyé.' };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  if (isDemo) return DEMO_ERROR;
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const bad = validatePassword(password) ?? (password !== confirm ? 'Les deux mots de passe ne correspondent pas.' : null);
  if (bad) return { error: bad };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: frenchAuthError(error.message) };
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
