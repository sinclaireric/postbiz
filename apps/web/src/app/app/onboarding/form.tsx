'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/auth/fields';
import { createOrganizationAction, type OnboardingState } from './actions';

export function OnboardingForm() {
  const [state, action] = useActionState<OnboardingState, FormData>(createOrganizationAction, {});
  return (
    <form action={action} className="grid gap-5">
      <Field label="Nom de votre organisation" name="name" placeholder="Ma marque, mon agence…" required minLength={2} maxLength={120} autoFocus />
      <FormMessage error={state.error} />
      <SubmitButton pending="Création…">Continuer</SubmitButton>
    </form>
  );
}
