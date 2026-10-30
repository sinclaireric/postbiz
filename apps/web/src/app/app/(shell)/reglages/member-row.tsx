'use client';

import { useActionState, useState } from 'react';
import { Badge } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { MemberItem, OrgRole } from '@/lib/data/types';
import { ORG_ROLES } from '@/lib/workspaces';
import { memberAction, type MemberState } from './actions';

/**
 * Un membre de l'espace. Un administrateur change son rôle (la liste envoie le formulaire dès qu'on choisit) ou le retire, après confirmation ;
 * chacun peut quitter l'espace. Le seul administrateur ne peut ni être retiré ni changer de rôle : la base le refuse aussi (`last_admin`).
 */
export function MemberRow({ member, you, manage, soleAdmin, canLeave }: { member: MemberItem; you: boolean; manage: boolean; soleAdmin: boolean; canLeave: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<MemberState, FormData>(memberAction, {});
  const [confirming, setConfirming] = useState(false);
  const locked = soleAdmin && member.role === 'admin';
  const removable = manage ? !you || canLeave : you && canLeave;
  const lockedHint = t('app.workspace.team.soleAdmin');

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wash text-sm font-bold">{member.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{member.name || member.email}{you && <span className="ms-2 text-sm text-subtle">{t('app.settings.you')}</span>}</span>
            {member.email && <span className="block truncate text-xs text-muted" dir="ltr">{member.email}</span>}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {manage ? (
            <form action={action}>
              <input type="hidden" name="intent" value="role" />
              <input type="hidden" name="userId" value={member.userId} />
              <select
                key={member.role} name="role" defaultValue={member.role} disabled={pending || locked} title={locked ? lockedHint : undefined}
                aria-label={t('app.workspace.team.roleOf', { name: member.name })}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm font-medium disabled:opacity-60"
              >
                {ORG_ROLES.map((r: OrgRole) => <option key={r} value={r}>{t(`common.role.${r}`)}</option>)}
              </select>
            </form>
          ) : (
            <Badge tone={member.role === 'admin' ? 'lime' : 'neutral'}>{t(`common.role.${member.role}`)}</Badge>
          )}
          {removable && !confirming && (
            <button type="button" disabled={pending || locked} title={locked ? lockedHint : undefined} onClick={() => setConfirming(true)} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-50 disabled:hover:bg-transparent">
              {you ? t('app.workspace.team.leave') : t('app.workspace.team.remove')}
            </button>
          )}
        </span>
      </div>
      {confirming && (
        <form action={action} className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm">
          <input type="hidden" name="intent" value="remove" />
          <input type="hidden" name="userId" value={member.userId} />
          <span className="flex-1 font-medium text-danger">{you ? t('app.workspace.team.confirmLeave') : t('app.workspace.team.confirmRemove', { name: member.name })}</span>
          <button type="submit" disabled={pending} className="rounded-lg bg-danger px-3 py-1.5 font-semibold text-white disabled:opacity-60">{you ? t('app.workspace.team.leave') : t('app.workspace.team.remove')}</button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 font-semibold hover:bg-white/60">{t('app.workspace.cancel')}</button>
        </form>
      )}
      {state.error && <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">{state.error}</p>}
    </li>
  );
}
