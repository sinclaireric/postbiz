'use client';

import { useActionState, useRef, useState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/auth/fields';
import { useT } from '@/i18n/client';
import { INVITATION_DAYS, ORG_ROLES, roleHelpKey } from '@/lib/workspaces';
import { inviteMemberAction, type InviteState } from './actions';

/** Inviter une adresse : le lien d'invitation s'affiche une seule fois, à copier et à envoyer à la personne. */
export function InviteForm() {
  const t = useT();
  const [state, action] = useActionState<InviteState, FormData>(inviteMemberAction, {});
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<(typeof ORG_ROLES)[number]>('member');
  const field = useRef<HTMLInputElement>(null);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      field.current?.select();
    }
  }

  return (
    <div>
      <form action={action} onSubmit={() => setCopied(false)} className="grid max-w-md gap-4">
        <Field label={t('app.workspace.invite.email')} name="email" type="email" required maxLength={254} autoComplete="off" dir="ltr" defaultValue={state.error ? state.email : undefined} />
        <div>
          <label htmlFor="invite-role" className="text-sm font-semibold">{t('app.workspace.invite.role')}</label>
          <select id="invite-role" name="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40">
            {ORG_ROLES.map((r) => <option key={r} value={r}>{t(`common.role.${r}`)}</option>)}
          </select>
          <p className="mt-1.5 text-sm text-muted">{t(roleHelpKey(role))}</p>
        </div>
        <FormMessage error={state.error} />
        <div className="max-w-[260px]"><SubmitButton pending={t('app.workspace.invite.creating')}>{t('app.workspace.invite.submit')}</SubmitButton></div>
      </form>

      {state.link && (
        <div role="status" className="mt-5 rounded-2xl border border-ok/30 bg-ok-soft p-4">
          <p className="text-sm font-semibold text-ok">{t('app.workspace.invite.ready', { email: state.email ?? '' })}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input ref={field} readOnly value={state.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={t('app.workspace.invite.link')} className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" />
            <button type="button" onClick={() => copy(state.link!)} className="h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-white hover:bg-black/80">{copied ? t('app.workspace.invite.copied') : t('app.workspace.invite.copy')}</button>
          </div>
          <p className="mt-3 text-sm text-muted">{t('app.workspace.invite.note', { days: INVITATION_DAYS })}</p>
        </div>
      )}
    </div>
  );
}
