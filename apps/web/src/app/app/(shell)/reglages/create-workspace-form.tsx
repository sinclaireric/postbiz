'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/auth/fields';
import { useT } from '@/i18n/client';
import { MAX_WORKSPACE_NAME_LENGTH, MIN_WORKSPACE_NAME_LENGTH } from '@/lib/workspace-name';
import { createWorkspaceAction, type WorkspaceFormState } from '../workspace-actions';

/** Créer un espace de travail. `canCopy` : proposer de reprendre les membres de l'espace courant (réservé à ses administrateurs). */
export function CreateWorkspaceForm({ currentName, canCopy }: { currentName: string; canCopy: boolean }) {
  const t = useT();
  const [state, action] = useActionState<WorkspaceFormState, FormData>(createWorkspaceAction, {});
  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field
        label={t('app.workspace.create.name')} name="name" defaultValue={state.name} placeholder={t('app.workspace.create.placeholder')}
        required minLength={MIN_WORKSPACE_NAME_LENGTH} maxLength={MAX_WORKSPACE_NAME_LENGTH} autoComplete="off"
      />
      {canCopy && (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="copyMembers" className="mt-0.5 size-4 accent-ink" />
          <span>{t('app.workspace.create.copyMembers', { name: currentName })}</span>
        </label>
      )}
      <FormMessage error={state.error} />
      <div className="max-w-[240px]"><SubmitButton pending={t('app.workspace.create.creating')}>{t('app.workspace.create.submit')}</SubmitButton></div>
    </form>
  );
}
