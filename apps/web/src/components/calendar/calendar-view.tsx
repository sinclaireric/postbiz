'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { deletePostAction, retryFirstCommentAction } from '@/app/app/(shell)/calendrier/actions';
import { Modal } from '@/components/app/modal';
import { NetworkDot, NetworkLabel } from '@/components/app/network-dot';
import { Badge, Button } from '@/components/ui';
import { LOCALE_META } from '@/i18n/config';
import { useT } from '@/i18n/client';
import { formatDateTime, formatLongDay, formatShortDate, formatTime, formatWeekday } from '@/i18n/format';
import type { MessageKey } from '@/i18n/types';
import {
  HOURS, addDays, dayKey, defaultTimeForDay, groupPosts, isPastSlot, monthGrid, rangeLabel, sameDay, shiftAnchor, slotKey, slotStart,
  toLocalInputValue, weekDays, type CalendarView as View,
} from '@/lib/calendar/logic';
import type { FirstCommentState, IntegrationItem, KnowledgeItem, PostItem, PostState } from '@/lib/data/types';
import { ChannelsPanel } from './channels-panel';
import { MediaThumb } from '@/components/media/media-thumb';
import { Composer } from './composer';

const STATE_TONE: Record<PostState, 'neutral' | 'ok' | 'warn' | 'lime'> = {
  draft: 'neutral', queued: 'lime', publishing: 'warn', published: 'ok', error: 'warn', unknown: 'warn',
};
const STATE_KEY: Record<PostState, MessageKey> = {
  draft: 'app.calendar.state.draft', queued: 'app.calendar.state.queued', publishing: 'app.calendar.state.publishing',
  published: 'app.calendar.state.published', error: 'app.calendar.state.error', unknown: 'app.calendar.state.unknown',
};
const CHIP: Record<PostState, string> = {
  draft: 'border-line bg-wash text-muted',
  queued: 'border-lime bg-lime-soft text-forest',
  publishing: 'border-warn/40 bg-warn-soft text-warn',
  published: 'border-ok/30 bg-ok-soft text-ok',
  error: 'border-warn/50 bg-warn-soft text-warn',
  unknown: 'border-warn/50 bg-warn-soft text-warn',
};
const COMMENT_TONE: Record<FirstCommentState, 'neutral' | 'ok' | 'warn' | 'lime'> = { pending: 'neutral', posting: 'lime', posted: 'ok', failed: 'warn', unknown: 'warn' };
const COMMENT_KEY: Record<FirstCommentState, MessageKey> = {
  pending: 'app.calendar.commentState.pending', posting: 'app.calendar.commentState.posting', posted: 'app.calendar.commentState.posted',
  failed: 'app.calendar.commentState.failed', unknown: 'app.calendar.commentState.unknown',
};
const DELETABLE: PostState[] = ['draft', 'queued', 'error', 'unknown'];
const HATCH = 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(17,17,16,0.045)_6px_7px)]';

function Chip({ post, onOpen }: { post: PostItem; onOpen: (p: PostItem) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(post); }}
      title={post.content}
      className={`flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-1.5 py-1 text-start text-[11px] leading-tight font-medium ${CHIP[post.state]}`}
    >
      <NetworkDot id={post.networkId} size={8} />
      <span className="shrink-0 tabular-nums">{post.publishAt ? formatTime(t.locale, post.publishAt) : ''}</span>
      {post.media[0] && <span className="h-4 w-4 shrink-0 overflow-hidden rounded-[4px]" aria-hidden="true"><MediaThumb item={{ kind: post.media[0].kind, url: null, thumbUrl: post.media[0].thumbUrl, name: post.media[0].name }} showDuration={false} /></span>}
      <span className="truncate">{post.content || t('app.calendar.noText')}</span>
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: React.ReactNode; aria?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          aria-label={o.aria}
          onClick={() => onChange(o.id)}
          className={`flex h-8 items-center rounded-lg px-3 text-sm font-semibold transition-colors ${value === o.id ? 'bg-lime-soft text-forest' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg className="rtl:rotate-180" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={dir === 'left' ? 'm10 3-5 5 5 5' : 'm6 3 5 5-5 5'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function CalendarView({ posts, integrations, knowledge, aiEnabled, canWrite, orgId, userId, demo }: { posts: PostItem[]; integrations: IntegrationItem[]; knowledge: KnowledgeItem[]; aiEnabled: boolean; canWrite: boolean; orgId: string; userId: string; demo: boolean }) {
  const t = useT();
  // Les dates dépendent du fuseau du navigateur : on les calcule après le montage pour éviter tout décalage serveur/client.
  const [now, setNow] = useState<Date | null>(null);
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [view, setView] = useState<View>('week');
  const [list, setList] = useState(false);
  const [panel, setPanel] = useState(true);
  const [composer, setComposer] = useState<string | null>(null);
  const [detail, setDetail] = useState<PostItem | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const n = new Date();
    setNow(n);
    setAnchor(n);
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // À l'ouverture de la semaine ou du jour, on amène l'heure courante (ou 8 h) en vue.
  useEffect(() => {
    if (!now || !scroller.current || view === 'month' || list) return;
    scroller.current.scrollTop = Math.max(0, (sameDay(now, anchor ?? now) ? now.getHours() - 1 : 7) * 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, list, anchor === null]);

  const bySlot = useMemo(() => groupPosts(posts, 'slot'), [posts]);
  const byDay = useMemo(() => groupPosts(posts, 'day'), [posts]);

  if (!now || !anchor) {
    return <div className="flex-1 p-6" aria-busy="true"><div className="h-12 w-72 animate-pulse rounded-xl bg-wash" /></div>;
  }

  const openComposer = (d: Date) => canWrite && setComposer(toLocalInputValue(d));
  const days = view === 'day' ? [anchor] : weekDays(anchor);
  const tag = LOCALE_META[t.locale].tag;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Panneau des canaux */}
      {panel && (
        <aside className="hidden w-[300px] shrink-0 border-e border-line bg-surface p-4 lg:flex lg:flex-col" aria-label={t('app.calendar.channels')}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">{t('app.calendar.channels')}</h2>
            <button type="button" onClick={() => setPanel(false)} aria-label={t('app.calendar.hidePanel')} className="flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-muted hover:text-ink"><Chevron dir="left" /></button>
          </div>
          <ChannelsPanel integrations={integrations} canWrite={canWrite} />
        </aside>
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('app.calendar.label')}>
        {/* Barre d'outils */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
          {!panel && (
            <button type="button" onClick={() => setPanel(true)} aria-label={t('app.calendar.showPanel')} className="hidden h-9 w-9 items-center justify-center rounded-lg bg-wash text-muted hover:text-ink lg:flex"><Chevron dir="right" /></button>
          )}
          <div className="flex items-center rounded-xl border border-line bg-surface">
            <button type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} aria-label={t('app.calendar.previous')} className="flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Chevron dir="left" /></button>
            <span className="min-w-[140px] border-x border-line px-2 text-center text-sm font-semibold capitalize sm:min-w-[170px] sm:px-3" aria-live="polite">{rangeLabel(view, anchor, tag)}</span>
            <button type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} aria-label={t('app.calendar.next')} className="flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Chevron dir="right" /></button>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAnchor(new Date())} className="!rounded-xl">{t('app.calendar.today')}</Button>

          <div className="ms-auto flex flex-wrap items-center gap-3">
            <Segmented<View> label={t('app.calendar.display')} value={view} onChange={setView} options={[{ id: 'day', label: t('app.calendar.day') }, { id: 'week', label: t('app.calendar.week') }, { id: 'month', label: t('app.calendar.month') }]} />
            <Segmented<'calendar' | 'list'>
              label={t('app.calendar.mode')}
              value={list ? 'list' : 'calendar'}
              onChange={(v) => setList(v === 'list')}
              options={[
                { id: 'calendar', aria: t('app.calendar.calendarView'), label: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M5 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 4.5h14M7 2.5v3m6-3v3" /></svg> },
                { id: 'list', aria: t('app.calendar.listView'), label: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></svg> },
              ]}
            />
            {canWrite && integrations.length > 0 && (
              <Button type="button" size="sm" onClick={() => openComposer(defaultTimeForDay(anchor, now))}>{t('app.calendar.newPost')}</Button>
            )}
          </div>
        </div>

        {/* Canaux (mobile) */}
        <div className="flex gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2.5 lg:hidden" aria-label={t('app.calendar.channels')}>
          <a href="/app/canaux" className="flex h-8 shrink-0 items-center rounded-full bg-ink px-3.5 text-xs font-semibold text-white">{t('app.calendar.addChannelShort')}</a>
          {integrations.map((i) => (
            <span key={i.id} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold"><NetworkDot id={i.networkId} size={8} />{i.name}</span>
          ))}
        </div>

        {list ? (
          <PostList posts={posts} onOpen={setDetail} now={now} />
        ) : view === 'month' ? (
          <MonthGrid anchor={anchor} now={now} byDay={byDay} canWrite={canWrite} onCreate={openComposer} onOpen={setDetail} />
        ) : (
          <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-surface">
            <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div className="sticky top-0 z-10 border-b border-line bg-surface" />
              {days.map((d) => (
                <div key={dayKey(d)} className="sticky top-0 z-10 border-b border-s border-line bg-surface px-2 py-2.5 text-center">
                  <p className={`text-sm capitalize ${sameDay(d, now) ? 'font-bold text-forest' : 'text-muted'}`}>{formatWeekday(t.locale, d)}</p>
                  <p className={`text-sm ${sameDay(d, now) ? 'font-bold text-forest' : 'text-ink'}`}>
                    {sameDay(d, now) && <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-lime align-middle" aria-hidden="true" />}
                    {formatShortDate(t.locale, d)}
                  </p>
                </div>
              ))}
              {HOURS.map((h) => (
                <Row key={h} hour={h} days={days} now={now} bySlot={bySlot} canWrite={canWrite} onCreate={openComposer} onOpen={setDetail} />
              ))}
            </div>
          </div>
        )}
      </section>

      {composer !== null && (
        <Modal title={t('app.composer.title')} onClose={() => setComposer(null)} width="max-w-6xl" header={false}>
          <Composer integrations={integrations} knowledge={knowledge} aiEnabled={aiEnabled} canWrite={canWrite} orgId={orgId} userId={userId} demo={demo} initialLocal={composer} onSaved={() => setComposer(null)} onClose={() => setComposer(null)} />
        </Modal>
      )}
      {detail && <PostDialog post={detail} canWrite={canWrite} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Row({ hour, days, now, bySlot, canWrite, onCreate, onOpen }: {
  hour: number; days: Date[]; now: Date; bySlot: Map<string, PostItem[]>; canWrite: boolean; onCreate: (d: Date) => void; onOpen: (p: PostItem) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="h-16 border-b border-line pe-3 ps-1 text-end text-sm text-muted tabular-nums">
        <span className={`relative bg-surface px-1 ${hour === 0 ? 'top-1' : '-top-2.5'}`}>{hour}:00</span>
      </div>
      {days.map((d) => {
        const start = slotStart(d, hour);
        const past = isPastSlot(start, now);
        const items = bySlot.get(slotKey(start)) ?? [];
        return (
          <div key={dayKey(d)} className={`group relative h-16 overflow-hidden border-b border-s border-line ${past ? HATCH : ''}`}>
            {!past && canWrite && (
              <button type="button" onClick={() => onCreate(start)} aria-label={t('app.calendar.createAtHour', { day: formatLongDay(t.locale, d), hour: `${hour}:00` })} className="absolute inset-0 hover:bg-lime-soft/50 focus-visible:bg-lime-soft/60" />
            )}
            <div className="pointer-events-none relative grid grid-cols-[minmax(0,1fr)] gap-0.5 p-0.5">
              {items.slice(0, 2).map((p) => <div key={p.id} className="pointer-events-auto"><Chip post={p} onOpen={onOpen} /></div>)}
              {items.length > 2 && <p className="pointer-events-auto px-1 text-[11px] font-semibold text-muted">{t('app.calendar.more', { count: items.length - 2 })}</p>}
            </div>
          </div>
        );
      })}
    </>
  );
}

function MonthGrid({ anchor, now, byDay, canWrite, onCreate, onOpen }: {
  anchor: Date; now: Date; byDay: Map<string, PostItem[]>; canWrite: boolean; onCreate: (d: Date) => void; onOpen: (p: PostItem) => void;
}) {
  const t = useT();
  const grid = monthGrid(anchor);
  const header = weekDays(now);
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface">
      <div className="grid min-w-[640px] grid-cols-7 border-b border-line">
        {header.map((d) => <p key={dayKey(d)} className="border-s border-line px-2 py-2.5 text-center text-sm text-muted first:border-s-0">{formatWeekday(t.locale, d, 'short')}</p>)}
      </div>
      <div className="grid min-w-[640px] grid-cols-7">
        {grid.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const past = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) <= now;
          const items = byDay.get(dayKey(d)) ?? [];
          const today = sameDay(d, now);
          return (
            <div key={dayKey(d)} className={`relative min-h-[112px] min-w-0 overflow-hidden border-b border-s border-line p-1.5 ${past ? HATCH : ''} ${inMonth ? '' : 'opacity-45'}`}>
              {!past && canWrite && (
                <button type="button" onClick={() => onCreate(defaultTimeForDay(d, now))} aria-label={t('app.calendar.createOnDay', { day: formatLongDay(t.locale, d) })} className="absolute inset-0 hover:bg-lime-soft/50 focus-visible:bg-lime-soft/60" />
              )}
              <div className="pointer-events-none relative">
                <p className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${today ? 'bg-ink text-white' : 'text-muted'}`}>{d.getDate()}</p>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                  {items.slice(0, 3).map((p) => <div key={p.id} className="pointer-events-auto"><Chip post={p} onOpen={onOpen} /></div>)}
                  {items.length > 3 && <p className="pointer-events-auto px-1 text-[11px] font-semibold text-muted">{t('app.calendar.more', { count: items.length - 3 })}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PostList({ posts, onOpen, now }: { posts: PostItem[]; onOpen: (p: PostItem) => void; now: Date }) {
  const t = useT();
  const groups = [...groupPosts(posts, 'day').entries()];
  const undated = posts.filter((p) => !p.publishAt);
  if (groups.length === 0 && undated.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface p-10 text-center">
        <div><p className="text-lg font-semibold">{t('app.calendar.emptyTitle')}</p><p className="mt-1 text-sm text-muted">{t('app.calendar.emptyHint')}</p></div>
      </div>
    );
  }
  const label = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const day = new Date(y!, m! - 1, d!);
    if (sameDay(day, now)) return t('app.calendar.todayLabel');
    if (sameDay(day, addDays(now, 1))) return t('app.calendar.tomorrow');
    if (sameDay(day, addDays(now, -1))) return t('app.calendar.yesterday');
    return formatLongDay(t.locale, day);
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-5">
      <div className="mx-auto grid max-w-3xl gap-7">
        {groups.map(([key, items]) => (
          <div key={key}>
            <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{label(key)}</h3>
            <ul className="mt-3 grid gap-2.5">
              {items.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p)} className="w-full rounded-2xl border border-line bg-paper p-4 text-start transition hover:border-ink/30">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold"><NetworkLabel id={p.networkId} /><span className="font-normal text-muted">· {p.accountName}</span></span>
                      <span className="flex items-center gap-2"><span className="text-sm text-muted tabular-nums">{p.publishAt ? formatTime(t.locale, p.publishAt) : ''}</span><Badge tone={STATE_TONE[p.state]}>{t(STATE_KEY[p.state])}</Badge></span>
                    </span>
                    <span className="mt-2 line-clamp-2 block text-[15px] leading-relaxed">{p.content || <span className="text-subtle">{t('app.calendar.noText')}</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {undated.length > 0 && (
          <div>
            <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{t('app.calendar.noDate')}</h3>
            <ul className="mt-3 grid gap-2.5">
              {undated.map((p) => (
                <li key={p.id}><button type="button" onClick={() => onOpen(p)} className="w-full rounded-2xl border border-line bg-paper p-4 text-start hover:border-ink/30"><span className="text-sm font-semibold"><NetworkLabel id={p.networkId} /></span><span className="mt-1 line-clamp-2 block text-[15px]">{p.content || t('app.calendar.noText')}</span></button></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function PostDialog({ post, canWrite, onClose }: { post: PostItem; canWrite: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('app.calendar.detailTitle')} onClose={onClose} width="max-w-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><NetworkLabel id={post.networkId} /><span className="font-normal text-muted">· {post.accountName}</span></p>
        <Badge tone={STATE_TONE[post.state]}>{t(STATE_KEY[post.state])}</Badge>
      </div>
      {post.publishAt && <p className="mt-2 text-sm text-muted">{formatDateTime(t.locale, post.publishAt)}</p>}
      <p className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-paper p-4 text-[15px] leading-relaxed">{post.content || <span className="text-subtle">{t('app.calendar.noText')}</span>}</p>
      {post.media.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{t('app.calendar.media')}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {post.media.map((m) => (
              <li key={m.id} className="h-16 w-16 overflow-hidden rounded-xl border border-line" title={m.alt || m.name}>
                <MediaThumb item={{ kind: m.kind, url: null, thumbUrl: m.thumbUrl, name: m.name }} showDuration={false} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {post.error && <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{post.error}</p>}
      {post.firstComment && post.firstCommentState && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{t('app.calendar.firstComment')}</h3>
            <Badge tone={COMMENT_TONE[post.firstCommentState]}>{t(COMMENT_KEY[post.firstCommentState])}</Badge>
          </div>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-paper p-3.5 text-[14px] leading-relaxed">{post.firstComment}</p>
          {post.firstCommentError && <p role="alert" className="mt-2 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">{post.firstCommentError}</p>}
          {canWrite && post.firstCommentState === 'failed' && (
            <form action={async (fd) => { await retryFirstCommentAction(fd); onClose(); }} className="mt-2.5">
              <input type="hidden" name="postId" value={post.id} />
              <Button type="submit" variant="secondary" size="sm">{t('app.calendar.retryComment')}</Button>
            </form>
          )}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {post.releaseUrl ? <a href={post.releaseUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">{t('app.calendar.viewPost')}</a> : <span />}
        {canWrite && DELETABLE.includes(post.state) && (
          <form action={async (fd) => { await deletePostAction(fd); onClose(); }}>
            <input type="hidden" name="groupId" value={post.groupId} />
            <Button type="submit" variant="secondary" size="sm" className="!border-danger/40 !text-danger hover:!bg-danger-soft">{t('app.calendar.delete')}</Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
