import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NetworkDot } from '@/components/app/network-dot';
import { Badge } from '@/components/ui';
import { getRepositories, getSession } from '@/lib/data';
import { CAPABILITY_LABEL, NETWORKS, networkById } from '@/lib/networks';

export const metadata: Metadata = { title: 'Canaux' };
export const dynamic = 'force-dynamic';

const STATUS = {
  active: { label: 'Connecté', tone: 'ok' as const },
  refresh_needed: { label: 'À reconnecter', tone: 'warn' as const },
  disabled: { label: 'Désactivé', tone: 'neutral' as const },
};

export default async function ChannelsPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const repos = await getRepositories(session.ctx);
  const integrations = await repos.workspace.integrations();

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Canaux</h1>
      <p className="mt-1 text-muted">Les comptes de réseaux sociaux connectés à votre organisation.</p>

      <section className="mt-8" aria-labelledby="connected">
        <h2 id="connected" className="text-sm font-semibold tracking-wide text-muted uppercase">Connectés ({integrations.length})</h2>
        {integrations.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line bg-surface p-8 text-center text-muted">Aucun canal connecté pour l’instant.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {integrations.map((i) => (
              <li key={i.id} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-wash"><NetworkDot id={i.networkId} size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{i.name}</span>
                  <span className="block truncate text-sm text-muted">{networkById(i.networkId)?.name}{i.username ? ` · ${i.username}` : ''}</span>
                </span>
                <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="add">
        <h2 id="add" className="text-sm font-semibold tracking-wide text-muted uppercase">Connecter un canal</h2>
        <div className="mt-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
          La connexion des comptes s’active quand les clés API de chaque réseau sont configurées (applications Meta, Google, TikTok, LinkedIn, X). Voir <code>docs/RESEAUX.md</code> dans le dépôt pour la marche à suivre.
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {NETWORKS.map((n) => (
            <li key={n.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2.5 font-semibold"><NetworkDot id={n.id} size={12} />{n.name}</p>
                <button disabled className="h-9 cursor-not-allowed rounded-full border border-line px-4 text-sm font-semibold text-subtle" title="Disponible dès que les clés API du réseau sont configurées">Connecter</button>
              </div>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>Publier : {CAPABILITY_LABEL[n.publish]}</span>
                <span>Messages : {CAPABILITY_LABEL[n.dm]}</span>
                <span>Commentaires : {CAPABILITY_LABEL[n.comments]}</span>
              </p>
              {n.note && <p className="mt-2 text-xs leading-relaxed text-subtle">{n.note}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
