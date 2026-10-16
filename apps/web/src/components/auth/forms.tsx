'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { forgotPassword, login, resetPassword, signup, type FormState } from '@/app/(auth)/actions';
import { Field, FormMessage, PasswordField, SubmitButton } from './fields';

const initial: FormState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(login, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="vous@exemple.fr" required />
      <PasswordField
        label="Mot de passe"
        name="password"
        autoComplete="current-password"
        required
        hint={<Link href="/forgot-password" className="text-sm font-medium text-muted underline underline-offset-4 hover:text-ink">Mot de passe oublié ?</Link>}
      />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending="Connexion…">Se connecter</SubmitButton>
    </form>
  );
}

export function SignupForm() {
  const [state, action] = useActionState(signup, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="vous@exemple.fr" required />
      <PasswordField label="Mot de passe" name="password" autoComplete="new-password" required minLength={8} />
      <PasswordField label="Confirmer le mot de passe" name="confirm" autoComplete="new-password" required minLength={8} />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending="Création du compte…">Créer mon compte</SubmitButton>
      <p className="text-center text-sm text-muted">
        En continuant, vous acceptez nos <Link href="/cgu" className="underline underline-offset-4">conditions d’utilisation</Link> et notre{' '}
        <Link href="/confidentialite" className="underline underline-offset-4">politique de confidentialité</Link>.
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPassword, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="vous@exemple.fr" required />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending="Envoi…">Envoyer le lien</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPassword, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <PasswordField label="Nouveau mot de passe" name="password" autoComplete="new-password" required minLength={8} />
      <PasswordField label="Confirmer le mot de passe" name="confirm" autoComplete="new-password" required minLength={8} />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pending="Enregistrement…">Enregistrer</SubmitButton>
    </form>
  );
}
