import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui';
import { getRepositories, getSession } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/data/types';
import { RenameForm } from './rename-form';

export const metadata: Metadata = { title: 'Réglages' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const members = await repos.workspace.members();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>

      <section className="mt-8 rounded-3xl border border-line bg-surface p-6" aria-labelledby="org">
        <h2 id="org" className="text-lg font-semibold">Organisation</h2>
        <div className="mt-4"><RenameForm name={ctx.org.name} disabled={ctx.org.role !== 'admin'} /></div>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-6" aria-labelledby="team">
        <h2 id="team" className="text-lg font-semibold">Équipe ({members.length})</h2>
        <ul className="mt-4 divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-3">
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wash text-sm font-bold">{m.name.slice(0, 1).toUpperCase()}</span>
                <span className="font-medium">{m.name}{m.userId === ctx.user.id && <span className="ml-2 text-sm text-subtle">(vous)</span>}</span>
              </span>
              <Badge tone={m.role === 'admin' ? 'lime' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">L’invitation de nouveaux membres arrive bientôt.</p>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-6" aria-labelledby="account">
        <h2 id="account" className="text-lg font-semibold">Mon compte</h2>
        <p className="mt-2 text-muted">{ctx.user.email}</p>
        <p className="mt-4 text-sm text-muted">
          Pour supprimer votre compte et vos données, suivez <Link href="/suppression-des-donnees" className="font-semibold text-ink underline underline-offset-4">la procédure de suppression</Link>.
        </p>
      </section>
    </div>
  );
}
