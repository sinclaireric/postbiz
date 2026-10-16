import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RichText } from '@/components/rich-text';
import { Badge } from '@/components/ui';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { RenameForm } from './rename-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.settings') };
}
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const members = await repos.workspace.members();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <section className="rounded-3xl border border-line bg-surface p-6" aria-labelledby="org">
        <h2 id="org" className="text-lg font-semibold">{t('app.settings.orgTitle')}</h2>
        <div className="mt-4"><RenameForm name={ctx.org.name} disabled={ctx.org.role !== 'admin'} /></div>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-6" aria-labelledby="team">
        <h2 id="team" className="text-lg font-semibold">{t('app.settings.teamTitle', { count: members.length })}</h2>
        <ul className="mt-4 divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-3">
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wash text-sm font-bold">{m.name.slice(0, 1).toUpperCase()}</span>
                <span className="font-medium">{m.name}{m.userId === ctx.user.id && <span className="ms-2 text-sm text-subtle">{t('app.settings.you')}</span>}</span>
              </span>
              <Badge tone={m.role === 'admin' ? 'lime' : 'neutral'}>{t(`common.role.${m.role}`)}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t('app.settings.inviteSoon')}</p>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-6" aria-labelledby="account">
        <h2 id="account" className="text-lg font-semibold">{t('app.settings.accountTitle')}</h2>
        <p className="mt-2 text-muted" dir="ltr">{ctx.user.email}</p>
        <p className="mt-4 text-sm text-muted">
          <RichText t={t} k="app.settings.deleteAccount" tags={{ link: (x) => <Link href="/suppression-des-donnees" className="font-semibold text-ink underline underline-offset-4">{x}</Link> }} />
        </p>
      </section>
    </div>
  );
}
