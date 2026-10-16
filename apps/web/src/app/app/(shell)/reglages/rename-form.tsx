'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/auth/fields';
import { renameOrganizationAction, type SettingsState } from './actions';

export function RenameForm({ name, disabled }: { name: string; disabled: boolean }) {
  const [state, action] = useActionState<SettingsState, FormData>(renameOrganizationAction, {});
  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field label="Nom de l’organisation" name="name" defaultValue={name} disabled={disabled} required minLength={2} maxLength={120} />
      <FormMessage error={state.error} message={state.saved ? 'Nom enregistré.' : undefined} />
      {!disabled && <div className="max-w-[200px]"><SubmitButton pending="Enregistrement…">Enregistrer</SubmitButton></div>}
    </form>
  );
}
