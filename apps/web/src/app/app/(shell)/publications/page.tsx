import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NetworkLabel } from '@/components/app/network-dot';
import { Badge } from '@/components/ui';
import { getRepositories, getSession } from '@/lib/data';
import type { PostItem, PostState } from '@/lib/data/types';
import { deletePostAction } from './actions';
import { Composer } from './composer';

export const metadata: Metadata = { title: 'Publications' };
export const dynamic = 'force-dynamic';

const STATE: Record<PostState, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'lime' }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  queued: { label: 'Programmée', tone: 'lime' },
  publishing: { label: 'En cours', tone: 'warn' },
  published: { label: 'Publiée', tone: 'ok' },
  error: { label: 'Erreur', tone: 'warn' },
  unknown: { label: 'Résultat inconnu', tone: 'warn' },
};

const dayKey = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-CA') : 'none');
const dayLabel = (iso: string | null, now: Date) => {
  if (!iso) return 'Sans date';
  const d = new Date(iso);
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

export default async function PublicationsPage() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const [posts, integrations] = await Promise.all([repos.posts.list(), repos.workspace.integrations()]);
  const now = new Date();
  const canWrite = ctx.org.role !== 'viewer';

  const groups = new Map<string, PostItem[]>();
  for (const p of posts) {
    const k = dayKey(p.publishAt);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-8 sm:px-8 xl:grid-cols-[1fr_420px]">
      <section aria-labelledby="planning">
        <h1 id="planning" className="text-2xl font-semibold tracking-tight">Publications</h1>
        <p className="mt-1 text-muted">Ce qui est prévu, publié ou en erreur, jour par jour.</p>

        {posts.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-line bg-surface p-10 text-center">
            <p className="font-semibold">Aucune publication</p>
            <p className="mt-1 text-sm text-muted">Créez votre première publication avec le formulaire.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-8">
            {[...groups.entries()].map(([k, items]) => (
              <div key={k}>
                <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{dayLabel(items[0]!.publishAt, now)}</h2>
                <ul className="mt-3 grid gap-3">
                  {items.map((p) => (
                    <li key={p.id} className="rounded-2xl border border-line bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 text-sm font-semibold"><NetworkLabel id={p.networkId} /><span className="font-normal text-muted">· {p.accountName}</span></p>
                        <div className="flex items-center gap-2">
                          {p.publishAt && <span className="text-sm text-muted">{new Date(p.publishAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
                          <Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[15px] leading-relaxed">{p.content || <span className="text-subtle">(sans texte)</span>}</p>
                      {p.error && <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{p.error}</p>}
                      <div className="mt-3 flex items-center gap-4 text-sm">
                        {p.releaseUrl && <a href={p.releaseUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">Voir la publication</a>}
                        {canWrite && ['draft', 'queued', 'error', 'unknown'].includes(p.state) && (
                          <form action={deletePostAction}>
                            <input type="hidden" name="groupId" value={p.groupId} />
                            <button className="font-medium text-muted underline underline-offset-4 hover:text-danger">Supprimer</button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <Composer integrations={integrations} canWrite={canWrite} />
        <p className="mt-3 px-2 text-xs leading-relaxed text-subtle">
          Les publications programmées sont envoyées par le worker Postbiz à l’heure choisie. Le téléversement d’images et de vidéos arrive bientôt : Instagram, TikTok et YouTube restent en brouillon d’ici là. <Link href="/canaux" className="underline">Voir l’état des canaux</Link>.
        </p>
      </aside>
    </div>
  );
}
