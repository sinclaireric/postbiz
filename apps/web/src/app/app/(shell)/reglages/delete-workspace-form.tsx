'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/auth/fields';
import { useT } from '@/i18n/client';
import { cleanWorkspaceName } from '@/lib/workspace-name';
import { deleteWorkspaceAction, type DeleteState } from './actions';

/** Supprimer l'espace courant : il faut en saisir le nom. La base refuse tant qu'il reste des canaux connectés ou des publications en file. */
export function DeleteWorkspaceForm({ name }: { name: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteWorkspaceAction, {});
  const matches = cleanWorkspaceName(typed) === cleanWorkspaceName(name);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-danger/40 px-5 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft">{t('app.workspace.delete.open')}</button>
    );
  }
  return (
    <form action={action} className="grid max-w-md gap-4">
      <p className="text-sm text-muted">{t('app.workspace.delete.warn', { name })}</p>
      <p className="text-sm text-muted">{t('app.workspace.delete.prereq')}</p>
      <div>
        <label htmlFor="delete-confirm" className="text-sm font-semibold">{t('app.workspace.delete.confirm', { name })}</label>
        <input
          id="delete-confirm" name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required
          className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-danger focus:ring-4 focus:ring-danger/20"
        />
      </div>
      <FormMessage error={state.error} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={!matches || pending} aria-busy={pending} className="rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? t('app.workspace.delete.deleting') : t('app.workspace.delete.submit')}</button>
        <button type="button" onClick={() => { setOpen(false); setTyped(''); }} className="rounded-full px-5 py-2.5 text-sm font-semibold hover:bg-wash">{t('app.workspace.cancel')}</button>
      </div>
    </form>
  );
}
