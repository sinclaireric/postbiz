'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/auth/fields';
import { useT } from '@/i18n/client';
import { renameOrganizationAction, type SettingsState } from './actions';

export function RenameForm({ name, disabled }: { name: string; disabled: boolean }) {
  const t = useT();
  const [state, action] = useActionState<SettingsState, FormData>(renameOrganizationAction, {});
  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field label={t('app.settings.orgName')} name="name" defaultValue={name} disabled={disabled} required minLength={2} maxLength={120} />
      <FormMessage error={state.error} message={state.saved ? t('app.settings.orgSaved') : undefined} />
      {!disabled && <div className="max-w-[200px]"><SubmitButton pending={t('app.settings.saving')}>{t('app.settings.save')}</SubmitButton></div>}
    </form>
  );
}
