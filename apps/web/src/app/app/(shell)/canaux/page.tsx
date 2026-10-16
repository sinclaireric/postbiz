import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NetworkDot } from '@/components/app/network-dot';
import { Badge } from '@/components/ui';
import { getRepositories, getSession } from '@/lib/data';
import { CAPABILITY_LABEL, NETWORKS, networkById } from '@/lib/networks';
import { networkAvailability } from '@/lib/oauth/availability';
import { ERROR_MESSAGES, type ErrorCode } from '@/lib/oauth/flow';
import { DisconnectButton } from './disconnect-button';

export const metadata: Metadata = { title: 'Canaux' };
export const dynamic = 'force-dynamic';

const STATUS = {
  active: { label: 'Connecté', tone: 'ok' as const },
  refresh_needed: { label: 'À reconnecter', tone: 'warn' as const },
  disabled: { label: 'Désactivé', tone: 'neutral' as const },
};

type Search = { connecte?: string; deconnecte?: string; erreur?: string; reseau?: string; webhooks?: string; nettoyage?: string };

/** Les messages viennent de codes fixes : on n'affiche jamais un texte pris dans l'URL. */
function banner(q: Search): { tone: 'ok' | 'warn' | 'danger'; text: string } | null {
  if (q.erreur) {
    const code = (q.erreur in ERROR_MESSAGES ? q.erreur : 'erreur') as ErrorCode;
    const net = q.reseau ? networkById(q.reseau)?.name : undefined;
    return { tone: 'danger', text: `${net ? `${net} : ` : ''}${ERROR_MESSAGES[code]}` };
  }
  if (q.connecte) {
    const n = Math.max(0, Math.min(99, Number.parseInt(q.connecte, 10) || 0));
    const warn = q.webhooks === 'ko' ? ' Attention : l’abonnement aux messages de la Page a échoué, vous ne recevrez pas ses messages dans l’inbox tant qu’il n’est pas refait (reconnectez le canal).' : '';
    return { tone: q.webhooks === 'ko' ? 'warn' : 'ok', text: `${n > 1 ? `${n} canaux connectés` : 'Canal connecté'}.${warn}` };
  }
  if (q.deconnecte) {
    return q.nettoyage === 'ko'
      ? { tone: 'warn', text: 'Canal déconnecté et jetons supprimés ici. La révocation chez le réseau a échoué : retirez Postbiz des applications autorisées de votre compte.' }
      : { tone: 'ok', text: 'Canal déconnecté : les jetons ont été supprimés.' };
  }
  return null;
}

const BANNER_CLASS = { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', danger: 'border-danger/30 bg-danger-soft text-danger' };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const repos = await getRepositories(session.ctx);
  const integrations = await repos.workspace.integrations();
  const q = await searchParams;
  const flash = banner(q);

  const isAdmin = session.ctx.org.role === 'admin';
  const demo = session.ctx.mode === 'demo';
  const availability = networkAvailability(process.env, demo);
  const anyAvailable = Object.values(availability).some((a) => a.available);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <p className="mt-1 text-muted">Les comptes de réseaux sociaux connectés à votre organisation.</p>

      {flash && <p role="status" className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${BANNER_CLASS[flash.tone]}`}>{flash.text}</p>}

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
                <span className="flex flex-col items-end gap-2">
                  <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                  {isAdmin && !demo && (
                    <span className="flex items-center gap-2">
                      {i.status === 'refresh_needed' && availability[i.networkId]?.available && (
                        <form method="post" action={`/api/oauth/start/${i.networkId}`}>
                          <button type="submit" className="h-8 rounded-full bg-ink px-3 text-xs font-semibold text-white">Reconnecter</button>
                        </form>
                      )}
                      <DisconnectButton integrationId={i.id} name={i.name} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="add">
        <h2 id="add" className="text-sm font-semibold tracking-wide text-muted uppercase">Connecter un canal</h2>
        {!anyAvailable && (
          <div className="mt-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
            {demo
              ? 'Mode démo : la connexion des comptes demande un projet Supabase configuré.'
              : 'La connexion des comptes s’active quand les clés API de chaque réseau sont configurées (applications Meta, Google, TikTok, LinkedIn, X).'}{' '}
            Voir <code>docs/RESEAUX.md</code> dans le dépôt pour la marche à suivre.
          </div>
        )}
        {anyAvailable && !isAdmin && (
          <p className="mt-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">Seul un administrateur de l’organisation peut connecter un canal.</p>
        )}
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {NETWORKS.map((n) => {
            const a = availability[n.id] ?? { available: false, missing: [] };
            const enabled = a.available && isAdmin;
            const why = demo
              ? 'Indisponible en mode démo'
              : !a.available
                ? `Configuration manquante sur le serveur : ${a.missing.join(', ')}`
                : !isAdmin
                  ? 'Réservé aux administrateurs'
                  : `Connecter ${n.name}`;
            return (
              <li key={n.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2.5 font-semibold"><NetworkDot id={n.id} size={12} />{n.name}</p>
                  <form method="post" action={`/api/oauth/start/${n.id}`}>
                    <button
                      type="submit"
                      disabled={!enabled}
                      title={why}
                      className={`h-9 rounded-full border px-4 text-sm font-semibold ${enabled ? 'border-ink bg-ink text-white hover:bg-black/80' : 'cursor-not-allowed border-line text-subtle'}`}
                    >
                      Connecter
                    </button>
                  </form>
                </div>
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>Publier : {CAPABILITY_LABEL[n.publish]}</span>
                  <span>Messages : {CAPABILITY_LABEL[n.dm]}</span>
                  <span>Commentaires : {CAPABILITY_LABEL[n.comments]}</span>
                </p>
                {n.note && <p className="mt-2 text-xs leading-relaxed text-subtle">{n.note}</p>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
