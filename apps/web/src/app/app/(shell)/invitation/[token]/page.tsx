import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { WorkspaceBadge } from '@/components/app/workspace-menu';
import { Button, ButtonLink } from '@/components/ui';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { isInvitationToken } from '@/lib/workspaces';
import { acceptInvitationAction } from '../../workspace-actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // Le jeton est dans l'adresse : ne pas la transmettre en `Referer` à un site tiers.
  return { title: t('app.workspace.invite.pageTitle'), referrer: 'no-referrer' };
}
export const dynamic = 'force-dynamic';

/** La page du lien d'invitation : qui invite, dans quel espace, avec quel rôle ; un bouton pour rejoindre. */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const preview = isInvitationToken(token) ? await (await getRepositories(session.ctx)).workspace.previewInvitation(token) : null;

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-12 sm:px-8">
      <section className="rounded-3xl border border-line bg-surface p-7 text-center" aria-labelledby="invitation-title">
        {preview ? (
          <>
            <div className="flex justify-center"><WorkspaceBadge name={preview.orgName} size={56} /></div>
            <h1 id="invitation-title" className="mt-5 text-xl font-semibold">{preview.orgName}</h1>
            <p className="mt-3 text-muted">
              {preview.inviterName
                ? t('app.workspace.invite.body', { inviter: preview.inviterName, role: t(`common.role.${preview.role}`) })
                : t('app.workspace.invite.bodyAnon', { role: t(`common.role.${preview.role}`) })}
            </p>
            {preview.alreadyMember && <p className="mt-3 text-sm font-medium text-ok">{t('app.workspace.invite.alreadyMember')}</p>}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <form action={acceptInvitationAction}>
                <input type="hidden" name="token" value={token} />
                <Button type="submit">{preview.alreadyMember ? t('app.workspace.invite.open') : t('app.workspace.invite.accept')}</Button>
              </form>
              <ButtonLink href="/app/calendrier" variant="secondary">{t('app.workspace.invite.later')}</ButtonLink>
            </div>
          </>
        ) : (
          <>
            <h1 id="invitation-title" className="text-xl font-semibold">{t('app.workspace.invite.invalidTitle')}</h1>
            <p className="mt-3 text-muted">{t('app.workspace.invite.invalidBody')}</p>
            <p className="mt-6"><Link href="/app/calendrier" className="font-semibold text-ink underline underline-offset-4">{t('app.workspace.invite.back')}</Link></p>
          </>
        )}
      </section>
    </div>
  );
}
