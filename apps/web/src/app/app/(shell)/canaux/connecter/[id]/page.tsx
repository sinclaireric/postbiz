import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NetworkDot } from '@/components/app/network-dot';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/data';
import { ERROR_MESSAGES, getPendingSelection } from '@/lib/oauth/flow';
import { createFlowDeps } from '@/lib/oauth/server';
import { networkById } from '@/lib/networks';
import { confirmSelectionAction } from '../../actions';

export const metadata: Metadata = { title: 'Choisir les comptes à connecter' };
export const dynamic = 'force-dynamic';

export default async function SelectAccountsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string }> }) {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const deps = createFlowDeps();
  if (session.ctx.mode === 'demo' || !deps) redirect('/app/canaux');

  const { id } = await params;
  const { erreur } = await searchParams;
  const pending = await getPendingSelection(deps, { userId: session.ctx.user.id, pendingId: id });
  if (!pending) redirect('/app/canaux?erreur=expire');

  const network = networkById(pending.network);
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Choisissez les comptes à connecter</h1>
      <p className="mt-1 text-muted">
        {network?.name} a autorisé l’accès aux comptes ci-dessous. Cochez ceux que vous voulez utiliser dans {session.ctx.org.name}.
      </p>
      {erreur === 'selection_vide' && (
        <p role="alert" className="mt-4 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{ERROR_MESSAGES.selection_vide}</p>
      )}
      <form action={confirmSelectionAction} className="mt-6">
        <input type="hidden" name="pendingId" value={id} />
        <ul className="grid gap-3">
          {pending.candidates.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-line bg-surface p-4 has-[:checked]:border-ink">
                <input type="checkbox" name="account" value={c.key} defaultChecked={pending.candidates.length === 1} className="h-4 w-4" />
                {c.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.pictureUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full bg-wash object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-wash"><NetworkDot id={c.network} size={14} /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  {c.username && <span className="block truncate text-sm text-muted">{c.username}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit">Connecter la sélection</Button>
          <Link href="/app/canaux" className="text-sm text-muted underline">Annuler</Link>
        </div>
      </form>
    </div>
  );
}
