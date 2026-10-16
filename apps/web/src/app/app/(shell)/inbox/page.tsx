import type { Metadata } from 'next';
import Link from 'next/link';
import { NetworkDot, NetworkLabel } from '@/components/app/network-dot';
import { RealtimeRefresh } from '@/components/app/realtime-refresh';
import { Badge } from '@/components/ui';
import { getRepositories, getSession } from '@/lib/data';
import {
  STATUS_LABEL, filterConversations, formatRelative, replyWindow, sortConversations, type InboxFilters,
} from '@/lib/inbox/logic';
import type { ConversationDetail, ConversationSummary, MessageItem } from '@/lib/inbox/types';
import { NETWORKS } from '@/lib/networks';
import { redirect } from 'next/navigation';
import { setStatusAction } from './actions';
import { NoteForm, ReplyForm } from './reply-form';

export const metadata: Metadata = { title: 'Boîte de réception' };
export const dynamic = 'force-dynamic';

type Params = { c?: string; status?: string; net?: string; q?: string };

const TABS: { id: NonNullable<InboxFilters['status']>; label: string }[] = [
  { id: 'active', label: 'Actives' },
  { id: 'unread', label: 'Non lues' },
  { id: 'closed', label: 'Fermées' },
  { id: 'all', label: 'Toutes' },
];

function href(p: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
  const s = sp.toString();
  return `/app/inbox${s ? `?${s}` : ''}`;
}

function WindowBadge({ expiresAt, now }: { expiresAt: string | null; now: Date }) {
  const w = replyWindow(expiresAt, now);
  if (w.state === 'none') return null;
  const tone = w.state === 'open' ? 'ok' : w.state === 'urgent' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{w.label}</Badge>;
}

function ConversationRow({ c, active, params, now }: { c: ConversationSummary; active: boolean; params: Params; now: Date }) {
  const w = replyWindow(c.replyWindowExpiresAt, now);
  return (
    <li>
      <Link
        href={href({ ...params, c: c.id })}
        aria-current={active ? 'true' : undefined}
        className={`flex gap-3 border-b border-line px-4 py-3.5 transition-colors ${active ? 'bg-lime-soft/70' : 'hover:bg-wash'}`}
      >
        <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wash text-sm font-bold">
          {c.contactName.slice(0, 1).toUpperCase()}
          <span className="absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-paper"><NetworkDot id={c.networkId} size={12} /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-[15px] ${c.unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}>{c.contactName}</span>
            <span className="shrink-0 text-xs text-subtle">{formatRelative(c.lastMessageAt, now)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${c.unreadCount > 0 ? 'text-ink' : 'text-muted'}`}>{c.lastMessagePreview}</span>
            {c.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-bold text-white">{c.unreadCount}</span>}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
            <span>{c.kind === 'dm' ? 'Message privé' : 'Commentaire'}</span>
            {c.status !== 'open' && <span>· {STATUS_LABEL[c.status]}</span>}
            {c.assigneeName && <span>· {c.assigneeName}</span>}
            {(w.state === 'urgent' || w.state === 'expired') && (
              <span className={`font-semibold ${w.state === 'urgent' ? 'text-warn' : 'text-danger'}`}>· {w.state === 'urgent' ? w.label : 'Expirée'}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

const DELIVERY: Record<MessageItem['deliveryStatus'], string> = {
  received: '', queued: 'En file d’envoi…', sending: 'Envoi en cours…', sent: '', failed: 'Échec de l’envoi',
};

function Bubble({ m, now }: { m: MessageItem; now: Date }) {
  const out = m.direction === 'out';
  return (
    <div className={`flex flex-col ${out ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${out ? 'rounded-br-md bg-ink text-white' : 'rounded-bl-md bg-surface ring-1 ring-line'} ${m.deliveryStatus === 'failed' ? 'ring-2 ring-danger/60' : ''}`}>
        {m.body}
        {m.attachments.map((a, i) => (
          <span key={i} className="mt-1 block text-sm underline">{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">Pièce jointe ({a.type})</a> : `Pièce jointe (${a.type})`}</span>
        ))}
      </div>
      <p className="mt-1 px-1 text-xs text-subtle">
        {out && m.sentByName ? `${m.sentByName} · ` : ''}
        {formatRelative(m.createdAt, now)}
        {DELIVERY[m.deliveryStatus] && (
          <span className={m.deliveryStatus === 'failed' ? 'font-semibold text-danger' : ''}> · {DELIVERY[m.deliveryStatus]}{m.deliveryStatus === 'failed' && m.error ? ` — ${m.error}` : ''}</span>
        )}
      </p>
    </div>
  );
}

function Thread({ c, params, now, canReply }: { c: ConversationDetail; params: Params; now: Date; canReply: boolean }) {
  const w = replyWindow(c.replyWindowExpiresAt, now);
  const isDm = c.kind === 'dm';
  const replyBlocked = !canReply || w.state === 'expired';
  const reason = !canReply
    ? 'Votre rôle (lecteur) ne permet pas de répondre.'
    : 'La fenêtre de 24 heures est dépassée : Meta n’autorise plus de réponse à cette conversation. Le client doit vous écrire de nouveau.';

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-paper" aria-label={`Conversation avec ${c.contactName}`}>
      <header className="border-b border-line bg-surface px-5 py-4">
        <Link href={href({ ...params, c: undefined })} className="mb-2 inline-block text-sm font-medium text-muted lg:hidden">← Retour à la liste</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{c.contactName}{c.contactUsername && <span className="ml-2 text-sm font-normal text-subtle">@{c.contactUsername}</span>}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <NetworkLabel id={c.networkId} />
              <span>· {c.accountName}</span>
              <span>· {isDm ? 'Message privé' : 'Commentaire public'}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WindowBadge expiresAt={c.replyWindowExpiresAt} now={now} />
            <Badge tone={c.status === 'closed' ? 'neutral' : c.status === 'pending' ? 'warn' : 'ok'}>{STATUS_LABEL[c.status]}</Badge>
          </div>
        </div>
        {canReply && (
          <form action={setStatusAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="conversationId" value={c.id} />
            {c.status === 'closed' ? (
              <button name="status" value="open" className="h-8 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-wash">Rouvrir</button>
            ) : (
              <>
                {c.status !== 'pending' && <button name="status" value="pending" className="h-8 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-wash">Mettre en attente</button>}
                {c.status === 'pending' && <button name="status" value="open" className="h-8 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-wash">Remettre en ouverte</button>}
                <button name="status" value="closed" className="h-8 rounded-full bg-ink px-3.5 text-sm font-semibold text-white hover:bg-black/80">Fermer</button>
              </>
            )}
          </form>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto grid max-w-2xl gap-4">
          {c.messages.map((m) => <Bubble key={m.id} m={m} now={now} />)}
        </div>
      </div>

      <details className="border-t border-line bg-wash/60 px-5 py-3" open={c.notes.length > 0 ? undefined : undefined}>
        <summary className="flex items-center justify-between text-sm font-semibold">
          <span>Notes internes ({c.notes.length})</span>
          <span className="text-xs font-medium text-subtle">Visibles par l’équipe uniquement</span>
        </summary>
        <div className="mt-3 grid gap-3">
          {c.notes.map((n) => (
            <p key={n.id} className="rounded-xl bg-warn-soft/70 px-3 py-2 text-sm">
              <span className="font-semibold">{n.authorName}</span> <span className="text-xs text-subtle">· {formatRelative(n.createdAt, now)}</span>
              <span className="mt-0.5 block whitespace-pre-wrap text-ink/90">{n.body}</span>
            </p>
          ))}
          {canReply && <NoteForm conversationId={c.id} />}
        </div>
      </details>

      <ReplyForm
        conversationId={c.id}
        disabled={replyBlocked}
        disabledReason={reason}
        placeholder={isDm ? `Répondre à ${c.contactName}…` : 'Répondre publiquement au commentaire…'}
      />
    </section>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const now = new Date();

  // Ouvrir une conversation la marque comme lue.
  let selected: ConversationDetail | null = null;
  if (params.c) {
    selected = await repos.inbox.getConversation(params.c);
    if (selected && selected.unreadCount > 0) {
      await repos.inbox.markRead(selected.id);
      selected = { ...selected, unreadCount: 0 };
    }
  }

  const status = (TABS.some((t) => t.id === params.status) ? params.status : 'active') as NonNullable<InboxFilters['status']>;
  const all = await repos.inbox.listConversations();
  const list = sortConversations(filterConversations(all, { status, network: params.net, q: params.q }), now);
  const unreadTotal = all.reduce((n, c) => n + c.unreadCount, 0);
  const presentNetworks = NETWORKS.filter((n) => all.some((c) => c.networkId === n.id));
  const base: Params = { status: status === 'active' ? undefined : status, net: params.net, q: params.q };
  const canReply = ctx.org.role !== 'viewer';

  return (
    <div className="flex h-full min-h-0 flex-1">
      {ctx.mode === 'supabase' && <RealtimeRefresh orgId={ctx.org.id} />}

      <aside className={`${selected ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r border-line bg-paper lg:w-[390px]`}>
        <div className="border-b border-line bg-surface px-4 pt-4 pb-3">
          <p className="text-sm font-semibold text-muted">{unreadTotal > 0 ? `${unreadTotal} non lu${unreadTotal > 1 ? 's' : ''}` : 'Tout est lu'}</p>
          <form action="/app/inbox" className="mt-2.5">
            {base.status && <input type="hidden" name="status" value={base.status} />}
            {base.net && <input type="hidden" name="net" value={base.net} />}
            <label htmlFor="inbox-q" className="sr-only">Rechercher</label>
            <input id="inbox-q" name="q" defaultValue={params.q ?? ''} placeholder="Rechercher un nom ou un message…" className="h-10 w-full rounded-full border border-line bg-paper px-4 text-sm outline-none focus:border-ink focus:ring-4 focus:ring-lime/40" />
          </form>
          <nav className="mt-3 flex gap-1.5 overflow-x-auto" aria-label="Filtrer par statut">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={href({ ...base, status: t.id === 'active' ? undefined : t.id, c: undefined })}
                aria-current={status === t.id ? 'true' : undefined}
                className={`flex h-8 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold ${status === t.id ? 'bg-ink text-white' : 'bg-wash text-ink/75 hover:text-ink'}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {presentNetworks.length > 1 && (
            <nav className="mt-2 flex gap-1.5 overflow-x-auto" aria-label="Filtrer par réseau">
              <Link href={href({ ...base, net: undefined })} aria-current={!params.net ? 'true' : undefined} className={`flex h-7 shrink-0 items-center rounded-full border px-3 text-xs font-semibold ${!params.net ? 'border-ink' : 'border-line text-muted'}`}>Tous les réseaux</Link>
              {presentNetworks.map((n) => (
                <Link key={n.id} href={href({ ...base, net: n.id })} aria-current={params.net === n.id ? 'true' : undefined} className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${params.net === n.id ? 'border-ink' : 'border-line text-muted'}`}>
                  <NetworkDot id={n.id} size={8} />{n.name}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {list.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold">{all.length === 0 ? 'Aucun message pour l’instant' : 'Aucune conversation ne correspond'}</p>
            <p className="mt-2 text-sm text-muted">
              {all.length === 0 ? 'Connectez un canal : les messages et commentaires y arriveront en direct.' : 'Essayez un autre filtre ou une autre recherche.'}
            </p>
            {all.length === 0 && <Link href="/app/canaux" className="mt-5 inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white">Connecter un canal</Link>}
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.map((c) => <ConversationRow key={c.id} c={c} active={c.id === selected?.id} params={base} now={now} />)}
          </ul>
        )}
      </aside>

      {selected ? (
        <Thread c={selected} params={base} now={now} canReply={canReply} />
      ) : (
        <section className="hidden min-h-0 flex-1 items-center justify-center bg-paper lg:flex">
          <div className="max-w-sm text-center">
            <p className="text-xl font-semibold tracking-tight">Choisissez une conversation</p>
            <p className="mt-2 text-muted">Les plus urgentes — celles dont la fenêtre de réponse de 24 h va se fermer — apparaissent en haut de la liste.</p>
          </div>
        </section>
      )}
    </div>
  );
}
