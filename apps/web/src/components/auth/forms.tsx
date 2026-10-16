'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { forgotPassword, login, resetPassword, signup, type FormState } from '@/app/(auth)/actions';
import { RichText } from '@/components/rich-text';
import { useT } from '@/i18n/client';
import { Field, FormMessage, PasswordField, SubmitButton } from './fields';

const initial: FormState = {};

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const [state, action] = useActionState(login, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label={t('auth.email')} name="email" type="email" autoComplete="email" placeholder={t('auth.emailPlaceholder')} dir="ltr" required />
      <PasswordField
        label={t('auth.password')}
        name="password"
        autoComplete="current-password"
        required
        hint={<Link href="/forgot-password" className="text-sm font-medium text-muted underline underline-offset-4 hover:text-ink">{t('auth.login.forgot')}</Link>}
      />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending={t('auth.login.pending')}>{t('auth.login.submit')}</SubmitButton>
    </form>
  );
}

export function SignupForm() {
  const t = useT();
  const [state, action] = useActionState(signup, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <Field label={t('auth.email')} name="email" type="email" autoComplete="email" placeholder={t('auth.emailPlaceholder')} dir="ltr" required />
      <PasswordField label={t('auth.password')} name="password" autoComplete="new-password" required minLength={8} />
      <PasswordField label={t('auth.confirmPassword')} name="confirm" autoComplete="new-password" required minLength={8} />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending={t('auth.signup.pending')}>{t('auth.signup.submit')}</SubmitButton>
      <p className="text-center text-sm text-muted">
        <RichText
          t={t}
          k="auth.signup.legal"
          tags={{
            terms: (x) => <Link href="/cgu" className="underline underline-offset-4">{x}</Link>,
            privacy: (x) => <Link href="/confidentialite" className="underline underline-offset-4">{x}</Link>,
          }}
        />
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useT();
  const [state, action] = useActionState(forgotPassword, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <Field label={t('auth.email')} name="email" type="email" autoComplete="email" placeholder={t('auth.emailPlaceholder')} dir="ltr" required />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending={t('auth.forgot.pending')}>{t('auth.forgot.submit')}</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const t = useT();
  const [state, action] = useActionState(resetPassword, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <PasswordField label={t('auth.newPassword')} name="password" autoComplete="new-password" required minLength={8} />
      <PasswordField label={t('auth.confirmPassword')} name="confirm" autoComplete="new-password" required minLength={8} />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending={t('auth.reset.pending')}>{t('auth.reset.submit')}</SubmitButton>
    </form>
  );
}
