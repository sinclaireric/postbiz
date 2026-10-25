import type { Metadata } from 'next';
import Link from 'next/link';
import { NetworkDot, NetworkLabel } from '@/components/app/network-dot';
import { RealtimeRefresh } from '@/components/app/realtime-refresh';
import { Badge } from '@/components/ui';
import { getT } from '@/i18n/server';
import { aiConfigured } from '@/lib/ai/assistant';
import { suggestionsPerDay } from '@/lib/inbox/limits';
import type { MessageKey, T } from '@/i18n/types';
import { formatRelative } from '@/i18n/format';
import { getRepositories, getSession } from '@/lib/data';
import { STATUS_KEY, windowLabel } from '@/lib/inbox/format';
import { filterConversations, replyWindow, sortConversations, type InboxFilters } from '@/lib/inbox/logic';
import type { ConversationDetail, ConversationSummary, MessageItem } from '@/lib/inbox/types';
import { NETWORKS, networkName } from '@/lib/networks';
import { redirect } from 'next/navigation';
import { setStatusAction } from './actions';
import { NoteForm, ReplyForm } from './reply-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.inbox') };
}
export const dynamic = 'force-dynamic';

type Params = { c?: string; status?: string; net?: string; q?: string };

const TABS: { id: NonNullable<InboxFilters['status']>; label: MessageKey }[] = [
  { id: 'active', label: 'app.inbox.tabs.active' },
  { id: 'unread', label: 'app.inbox.tabs.unread' },
  { id: 'closed', label: 'app.inbox.tabs.closed' },
  { id: 'all', label: 'app.inbox.tabs.all' },
];

function href(p: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
  const s = sp.toString();
  return `/app/inbox${s ? `?${s}` : ''}`;
}

function WindowBadge({ t, expiresAt, now }: { t: T; expiresAt: string | null; now: Date }) {
  const w = replyWindow(expiresAt, now);
  if (w.state === 'none') return null;
  const tone = w.state === 'open' ? 'ok' : w.state === 'urgent' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{windowLabel(t, w)}</Badge>;
}

function ConversationRow({ t, c, active, params, now }: { t: T; c: ConversationSummary; active: boolean; params: Params; now: Date }) {
  const w = replyWindow(c.replyWindowExpiresAt, now);
  const name = c.contactName || t('app.inbox.unknownContact');
  return (
    <li>
      <Link
        href={href({ ...params, c: c.id })}
        aria-current={active ? 'true' : undefined}
        className={`flex gap-3 border-b border-line px-4 py-3.5 transition-colors ${active ? 'bg-lime-soft/70' : 'hover:bg-wash'}`}
      >
        <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wash text-sm font-bold">
          {name.slice(0, 1).toUpperCase()}
          <span className="absolute -end-0.5 -bottom-0.5 rounded-full border-2 border-paper"><NetworkDot id={c.networkId} size={12} /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span dir="auto" className={`truncate text-[15px] ${c.unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}>{name}</span>
            <span className="shrink-0 text-xs text-subtle">{formatRelative(t.locale, c.lastMessageAt, now)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span dir="auto" className={`truncate text-sm ${c.unreadCount > 0 ? 'text-ink' : 'text-muted'}`}>{c.lastMessagePreview}</span>
            {c.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-bold text-white">{c.unreadCount}</span>}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
            <span>{c.kind === 'dm' ? t('app.inbox.kindDm') : t('app.inbox.kindComment')}</span>
            {c.status !== 'open' && <span>· {t(STATUS_KEY[c.status])}</span>}
            {c.assigneeName && <span>· {c.assigneeName}</span>}
            {(w.state === 'urgent' || w.state === 'expired') && (
              <span className={`font-semibold ${w.state === 'urgent' ? 'text-warn' : 'text-danger'}`}>· {w.state === 'urgent' ? windowLabel(t, w) : t('app.inbox.expired')}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

const DELIVERY: Record<MessageItem['deliveryStatus'], MessageKey | null> = {
  received: null, queued: 'app.inbox.delivery.queued', sending: 'app.inbox.delivery.sending', sent: null, failed: 'app.inbox.delivery.failed',
};

function Bubble({ t, m, now }: { t: T; m: MessageItem; now: Date }) {
  const out = m.direction === 'out';
  return (
    <div className={`flex flex-col ${out ? 'items-end' : 'items-start'}`}>
      <div dir="auto" className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${out ? 'rounded-ee-md bg-ink text-white' : 'rounded-es-md bg-surface ring-1 ring-line'} ${m.deliveryStatus === 'failed' ? 'ring-2 ring-danger/60' : ''}`}>
        {m.body}
        {m.attachments.map((a, i) => (
          <span key={i} className="mt-1 block text-sm underline">{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{t('app.inbox.attachmentType', { type: a.type })}</a> : t('app.inbox.attachmentType', { type: a.type })}</span>
        ))}
      </div>
      <p className="mt-1 px-1 text-xs text-subtle">
        {out && m.sentByName ? `${m.sentByName} · ` : ''}
        {formatRelative(t.locale, m.createdAt, now)}
        {DELIVERY[m.deliveryStatus] && (
          <span className={m.deliveryStatus === 'failed' ? 'font-semibold text-danger' : ''}> · {t(DELIVERY[m.deliveryStatus]!)}{m.deliveryStatus === 'failed' && m.error ? ` — ${m.error}` : ''}</span>
        )}
      </p>
    </div>
  );
}

function Thread({ t, c, params, now, canReply, canSuggest }: { t: T; c: ConversationDetail; params: Params; now: Date; canReply: boolean; canSuggest: boolean }) {
  const name = c.contactName || t('app.inbox.unknownContact');
  const w = replyWindow(c.replyWindowExpiresAt, now);
  const isDm = c.kind === 'dm';
  const replyBlocked = !canReply || w.state === 'expired';
  const reason = !canReply ? t('app.inbox.viewerNoReply') : t('app.inbox.windowClosed');

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-paper" aria-label={t('app.inbox.conversationWith', { name })}>
      <header className="border-b border-line bg-surface px-5 py-4">
        <Link href={href({ ...params, c: undefined })} className="mb-2 inline-block text-sm font-medium text-muted lg:hidden">{t('app.inbox.backToList')}</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{name}{c.contactUsername && <span className="ms-2 text-sm font-normal text-subtle" dir="ltr">@{c.contactUsername}</span>}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <NetworkLabel id={c.networkId} />
              <span>· {c.accountName}</span>
              <span>· {isDm ? t('app.inbox.kindDm') : t('app.inbox.kindCommentPublic')}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WindowBadge t={t} expiresAt={c.replyWindowExpiresAt} now={now} />
            <Badge tone={c.status === 'closed' ? 'neutral' : c.status === 'pending' ? 'warn' : 'ok'}>{t(STATUS_KEY[c.status])}</Badge>
          </div>
        </div>
        {canReply && (
          <form action={setStatusAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="conversationId" value={c.id} />
            {c.status === 'closed' ? (
              <button name="status" value="open" className="h-8 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-wash">{t('app.inbox.reopen')}</button>
            ) : (
              <>
                {c.status !== 'pending' && <button name="status" value="pending" className="h-8 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-wash">{t('app.inbox.setPending')}</button>}
                {c.status === 'pending' && <button name="status" value="open" className="h-8 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-wash">{t('app.inbox.setOpen')}</button>}
                <button name="status" value="closed" className="h-8 rounded-full bg-ink px-3.5 text-sm font-semibold text-white hover:bg-black/80">{t('app.inbox.close')}</button>
              </>
            )}
          </form>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto grid max-w-2xl gap-4">
          {c.messages.map((m) => <Bubble key={m.id} t={t} m={m} now={now} />)}
        </div>
      </div>

      <details className="border-t border-line bg-wash/60 px-5 py-3" open={c.notes.length > 0 ? undefined : undefined}>
        <summary className="flex items-center justify-between text-sm font-semibold">
          <span>{t('app.inbox.notes.title', { count: c.notes.length })}</span>
          <span className="text-xs font-medium text-subtle">{t('app.inbox.notes.teamOnly')}</span>
        </summary>
        <div className="mt-3 grid gap-3">
          {c.notes.map((n) => (
            <p key={n.id} className="rounded-xl bg-warn-soft/70 px-3 py-2 text-sm">
              <span className="font-semibold">{n.authorName}</span> <span className="text-xs text-subtle">· {formatRelative(t.locale, n.createdAt, now)}</span>
              <span className="mt-0.5 block whitespace-pre-wrap text-ink/90">{n.body}</span>
            </p>
          ))}
          {canReply && <NoteForm conversationId={c.id} />}
        </div>
      </details>

      <ReplyForm
        key={c.id}
        canSuggest={canSuggest}
        conversationId={c.id}
        disabled={replyBlocked}
        disabledReason={reason}
        placeholder={isDm ? t('app.inbox.replyDm', { name }) : t('app.inbox.replyComment')}
      />
    </section>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await getT();
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
  // La suggestion de réponse : pour qui peut répondre, quand l'IA est configurée (ou en démonstration, où elle est simulée) et que le plafond du jour n'est pas à zéro.
  const canSuggest = canReply && (ctx.mode === 'demo' || aiConfigured()) && suggestionsPerDay() > 0;

  return (
    <div className="flex h-full min-h-0 flex-1">
      {ctx.mode === 'supabase' && <RealtimeRefresh orgId={ctx.org.id} />}

      <aside className={`${selected ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-e border-line bg-paper lg:w-[390px]`}>
        <div className="border-b border-line bg-surface px-4 pt-4 pb-3">
          <p className="text-sm font-semibold text-muted">{unreadTotal > 0 ? t('app.inbox.unread', { count: unreadTotal }) : t('app.inbox.allRead')}</p>
          <form action="/app/inbox" className="mt-2.5">
            {base.status && <input type="hidden" name="status" value={base.status} />}
            {base.net && <input type="hidden" name="net" value={base.net} />}
            <label htmlFor="inbox-q" className="sr-only">{t('app.inbox.searchLabel')}</label>
            <input id="inbox-q" name="q" defaultValue={params.q ?? ''} placeholder={t('app.inbox.searchPlaceholder')} className="h-10 w-full rounded-full border border-line bg-paper px-4 text-sm outline-none focus:border-ink focus:ring-4 focus:ring-lime/40" />
          </form>
          <nav className="mt-3 flex gap-1.5 overflow-x-auto" aria-label={t('app.inbox.filterStatus')}>
            {TABS.map((tab) => (
              <Link
                key={tab.id}
                href={href({ ...base, status: tab.id === 'active' ? undefined : tab.id, c: undefined })}
                aria-current={status === tab.id ? 'true' : undefined}
                className={`flex h-8 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold ${status === tab.id ? 'bg-ink text-white' : 'bg-wash text-ink/75 hover:text-ink'}`}
              >
                {t(tab.label)}
              </Link>
            ))}
          </nav>
          {presentNetworks.length > 1 && (
            <nav className="mt-2 flex gap-1.5 overflow-x-auto" aria-label={t('app.inbox.filterNetwork')}>
              <Link href={href({ ...base, net: undefined })} aria-current={!params.net ? 'true' : undefined} className={`flex h-7 shrink-0 items-center rounded-full border px-3 text-xs font-semibold ${!params.net ? 'border-ink' : 'border-line text-muted'}`}>{t('app.inbox.allNetworks')}</Link>
              {presentNetworks.map((n) => (
                <Link key={n.id} href={href({ ...base, net: n.id })} aria-current={params.net === n.id ? 'true' : undefined} className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${params.net === n.id ? 'border-ink' : 'border-line text-muted'}`}>
                  <NetworkDot id={n.id} size={8} />{networkName(n.id)}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {list.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold">{all.length === 0 ? t('app.inbox.emptyNone') : t('app.inbox.emptyNoMatch')}</p>
            <p className="mt-2 text-sm text-muted">
              {all.length === 0 ? t('app.inbox.emptyNoneHint') : t('app.inbox.emptyNoMatchHint')}
            </p>
            {all.length === 0 && <Link href="/app/canaux" className="mt-5 inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white">{t('app.inbox.connectChannel')}</Link>}
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.map((c) => <ConversationRow key={c.id} t={t} c={c} active={c.id === selected?.id} params={base} now={now} />)}
          </ul>
        )}
      </aside>

      {selected ? (
        <Thread t={t} c={selected} params={base} now={now} canReply={canReply} canSuggest={canSuggest} />
      ) : (
        <section className="hidden min-h-0 flex-1 items-center justify-center bg-paper lg:flex">
          <div className="max-w-sm text-center">
            <p className="text-xl font-semibold tracking-tight">{t('app.inbox.pickTitle')}</p>
            <p className="mt-2 text-muted">{t('app.inbox.pickText')}</p>
          </div>
        </section>
      )}
    </div>
  );
}
