import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { WorkspaceBadge } from '@/components/app/workspace-menu';
import { RichText } from '@/components/rich-text';
import { Badge, Button } from '@/components/ui';
import { formatFullDate } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { adminCount, canCreateWorkspace, canManageWorkspace, MAX_WORKSPACES } from '@/lib/workspaces';
import { acceptReceivedInvitationAction, declineReceivedInvitationAction, switchWorkspaceAction } from '../workspace-actions';
import { revokeInvitationAction } from './actions';
import { CreateWorkspaceForm } from './create-workspace-form';
import { DeleteWorkspaceForm } from './delete-workspace-form';
import { InviteForm } from './invite-form';
import { MemberRow } from './member-row';
import { RenameForm } from './rename-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.settings') };
}
export const dynamic = 'force-dynamic';

const card = 'rounded-3xl border border-line bg-surface p-6';

export default async function SettingsPage() {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const [members, invitations, received] = await Promise.all([repos.workspace.members(), repos.workspace.invitations(), repos.workspace.receivedInvitations()]);
  const manage = canManageWorkspace(ctx.org.role);
  const onlyOneSpace = ctx.workspaces.length <= 1;
  const soleAdmin = adminCount(members) <= 1;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      {received.length > 0 && (
        <section className={`${card} mb-6`} aria-labelledby="invitations" id="invitations">
          <h2 id="invitations" className="text-lg font-semibold">{t('app.workspace.received.title')}</h2>
          <ul className="mt-4 divide-y divide-line">
            {received.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="min-w-0 flex-1 text-sm">
                  {i.inviterName
                    ? t('app.workspace.received.item', { inviter: i.inviterName, space: i.orgName, role: t(`common.role.${i.role}`) })
                    : t('app.workspace.received.itemAnon', { space: i.orgName, role: t(`common.role.${i.role}`) })}
                </p>
                <span className="flex gap-2">
                  <form action={acceptReceivedInvitationAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" size="sm">{t('app.workspace.received.accept')}</Button>
                  </form>
                  <form action={declineReceivedInvitationAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" size="sm" variant="secondary">{t('app.workspace.received.decline')}</Button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card} aria-labelledby="espaces" id="espaces">
        <h2 id="espaces" className="text-lg font-semibold">{t('app.workspace.list.title')}</h2>
        <p className="mt-2 text-sm text-muted">{t('app.workspace.list.hint')}</p>
        <ul className="mt-4 divide-y divide-line">
          {ctx.workspaces.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <WorkspaceBadge name={w.name} size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="block text-sm text-muted">{t(`common.role.${w.role}`)}</span>
                </span>
              </span>
              {w.id === ctx.org.id ? (
                <Badge tone="lime">{t('app.workspace.list.current')}</Badge>
              ) : (
                <form action={switchWorkspaceAction}>
                  <input type="hidden" name="orgId" value={w.id} />
                  <input type="hidden" name="from" value="/app/reglages" />
                  <Button type="submit" size="sm" variant="secondary">{t('app.workspace.list.open')}</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t border-line pt-6">
          <h3 className="text-base font-semibold">{t('app.workspace.create.title')}</h3>
          {canCreateWorkspace(ctx.workspaces) ? (
            <>
              <p className="mt-2 mb-4 text-sm text-muted">{t('app.workspace.create.intro', { max: MAX_WORKSPACES })}</p>
              <CreateWorkspaceForm currentName={ctx.org.name} canCopy={manage && members.length > 1} />
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">{t('app.workspace.errors.notAdmin')}</p>
          )}
        </div>
      </section>

      <section className={`${card} mt-6`} aria-labelledby="org">
        <h2 id="org" className="text-lg font-semibold">{t('app.settings.orgTitle')}</h2>
        <div className="mt-4"><RenameForm name={ctx.org.name} disabled={!manage} /></div>
      </section>

      <section className={`${card} mt-6`} aria-labelledby="team">
        <h2 id="team" className="text-lg font-semibold">{t('app.settings.teamTitle', { count: members.length })}</h2>
        <ul className="mt-2 divide-y divide-line">
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} you={m.userId === ctx.user.id} manage={manage} soleAdmin={soleAdmin} canLeave={!onlyOneSpace && !(soleAdmin && m.role === 'admin')} />
          ))}
        </ul>
        {!manage && <p className="mt-4 text-sm text-muted">{t('app.workspace.team.adminsOnly')}</p>}

        {manage && (
          <>
            {invitations.length > 0 && (
              <div className="mt-6 border-t border-line pt-6">
                <h3 className="text-base font-semibold">{t('app.workspace.team.pending', { count: invitations.length })}</h3>
                <ul className="mt-2 divide-y divide-line">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium" dir="ltr">{i.email}</span>
                        <span className="block text-sm text-muted">{t(`common.role.${i.role}`)} · {t('app.workspace.team.expires', { date: formatFullDate(t.locale, new Date(i.expiresAt)) })}</span>
                      </span>
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <Button type="submit" size="sm" variant="secondary">{t('app.workspace.team.revoke')}</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 border-t border-line pt-6">
              <h3 className="text-base font-semibold">{t('app.workspace.invite.title')}</h3>
              <p className="mt-2 mb-4 text-sm text-muted">{t('app.workspace.invite.intro')}</p>
              <InviteForm />
            </div>
          </>
        )}
      </section>

      {manage && (
        <section className="mt-6 rounded-3xl border border-danger/30 bg-surface p-6" aria-labelledby="danger">
          <h2 id="danger" className="text-lg font-semibold text-danger">{t('app.workspace.delete.title')}</h2>
          {onlyOneSpace ? (
            <p className="mt-2 text-sm text-muted">{t('app.workspace.errors.lastWorkspace')}</p>
          ) : (
            <div className="mt-4"><DeleteWorkspaceForm name={ctx.org.name} /></div>
          )}
        </section>
      )}

      <section className={`${card} mt-6`} aria-labelledby="account">
        <h2 id="account" className="text-lg font-semibold">{t('app.settings.accountTitle')}</h2>
        <p className="mt-2 text-muted" dir="ltr">{ctx.user.email}</p>
        <p className="mt-4 text-sm text-muted">
          <RichText t={t} k="app.settings.deleteAccount" tags={{ link: (x) => <Link href="/suppression-des-donnees" className="font-semibold text-ink underline underline-offset-4">{x}</Link> }} />
        </p>
      </section>
    </div>
  );
}
