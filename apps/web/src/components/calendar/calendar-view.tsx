'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { deletePostAction } from '@/app/app/(shell)/calendrier/actions';
import { Modal } from '@/components/app/modal';
import { NetworkDot, NetworkLabel } from '@/components/app/network-dot';
import { Badge, Button } from '@/components/ui';
import {
  HOURS, addDays, dayKey, defaultTimeForDay, groupPosts, isPastSlot, monthGrid, rangeLabel, sameDay, shiftAnchor, slotKey, slotStart,
  toLocalInputValue, weekDays, type CalendarView as View,
} from '@/lib/calendar/logic';
import type { IntegrationItem, PostItem, PostState } from '@/lib/data/types';
import { ChannelsPanel } from './channels-panel';
import { Composer } from './composer';

const STATE: Record<PostState, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'lime' }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  queued: { label: 'Programmée', tone: 'lime' },
  publishing: { label: 'En cours', tone: 'warn' },
  published: { label: 'Publiée', tone: 'ok' },
  error: { label: 'Erreur', tone: 'warn' },
  unknown: { label: 'Résultat inconnu', tone: 'warn' },
};
const CHIP: Record<PostState, string> = {
  draft: 'border-line bg-wash text-muted',
  queued: 'border-lime bg-lime-soft text-forest',
  publishing: 'border-warn/40 bg-warn-soft text-warn',
  published: 'border-ok/30 bg-ok-soft text-ok',
  error: 'border-warn/50 bg-warn-soft text-warn',
  unknown: 'border-warn/50 bg-warn-soft text-warn',
};
const DELETABLE: PostState[] = ['draft', 'queued', 'error', 'unknown'];
const HATCH = 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(17,17,16,0.045)_6px_7px)]';
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const longDay = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function Chip({ post, onOpen }: { post: PostItem; onOpen: (p: PostItem) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(post); }}
      title={post.content}
      className={`flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-1.5 py-1 text-left text-[11px] leading-tight font-medium ${CHIP[post.state]}`}
    >
      <NetworkDot id={post.networkId} size={8} />
      <span className="shrink-0 tabular-nums">{post.publishAt ? time(post.publishAt) : ''}</span>
      <span className="truncate">{post.content || '(sans texte)'}</span>
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
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={dir === 'left' ? 'm10 3-5 5 5 5' : 'm6 3 5 5-5 5'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function CalendarView({ posts, integrations, canWrite }: { posts: PostItem[]; integrations: IntegrationItem[]; canWrite: boolean }) {
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
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Panneau des canaux */}
      {panel && (
        <aside className="hidden w-[300px] shrink-0 border-r border-line bg-surface p-4 lg:flex lg:flex-col" aria-label="Canaux">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Canaux</h2>
            <button type="button" onClick={() => setPanel(false)} aria-label="Masquer le panneau des canaux" className="flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-muted hover:text-ink"><Chevron dir="left" /></button>
          </div>
          <ChannelsPanel integrations={integrations} canWrite={canWrite} />
        </aside>
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Calendrier de publication">
        {/* Barre d'outils */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
          {!panel && (
            <button type="button" onClick={() => setPanel(true)} aria-label="Afficher le panneau des canaux" className="hidden h-9 w-9 items-center justify-center rounded-lg bg-wash text-muted hover:text-ink lg:flex"><Chevron dir="right" /></button>
          )}
          <div className="flex items-center rounded-xl border border-line bg-surface">
            <button type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} aria-label="Période précédente" className="flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Chevron dir="left" /></button>
            <span className="min-w-[140px] border-x border-line px-2 text-center sm:min-w-[170px] sm:px-3 text-sm font-semibold capitalize" aria-live="polite">{rangeLabel(view, anchor)}</span>
            <button type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} aria-label="Période suivante" className="flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Chevron dir="right" /></button>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAnchor(new Date())} className="!rounded-xl">Aujourd’hui</Button>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Segmented<View> label="Affichage" value={view} onChange={setView} options={[{ id: 'day', label: 'Jour' }, { id: 'week', label: 'Semaine' }, { id: 'month', label: 'Mois' }]} />
            <Segmented<'calendar' | 'list'>
              label="Mode"
              value={list ? 'list' : 'calendar'}
              onChange={(v) => setList(v === 'list')}
              options={[
                { id: 'calendar', aria: 'Vue calendrier', label: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M5 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 4.5h14M7 2.5v3m6-3v3" /></svg> },
                { id: 'list', aria: 'Vue liste', label: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></svg> },
              ]}
            />
            {canWrite && integrations.length > 0 && (
              <Button type="button" size="sm" onClick={() => openComposer(defaultTimeForDay(anchor, now))}>Nouvelle publication</Button>
            )}
          </div>
        </div>

        {/* Canaux (mobile) */}
        <div className="flex gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2.5 lg:hidden" aria-label="Canaux">
          <a href="/app/canaux" className="flex h-8 shrink-0 items-center rounded-full bg-ink px-3.5 text-xs font-semibold text-white">+ Canal</a>
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
                <div key={dayKey(d)} className="sticky top-0 z-10 border-b border-l border-line bg-surface px-2 py-2.5 text-center">
                  <p className={`text-sm capitalize ${sameDay(d, now) ? 'font-bold text-forest' : 'text-muted'}`}>{d.toLocaleDateString('fr-FR', { weekday: 'long' })}</p>
                  <p className={`text-sm ${sameDay(d, now) ? 'font-bold text-forest' : 'text-ink'}`}>
                    {sameDay(d, now) && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-lime align-middle" aria-hidden="true" />}
                    {d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
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
        <Modal title="Nouvelle publication" onClose={() => setComposer(null)} width="max-w-2xl">
          <Composer integrations={integrations} canWrite={canWrite} initialLocal={composer} embedded onSaved={() => setComposer(null)} />
        </Modal>
      )}
      {detail && <PostDialog post={detail} canWrite={canWrite} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Row({ hour, days, now, bySlot, canWrite, onCreate, onOpen }: {
  hour: number; days: Date[]; now: Date; bySlot: Map<string, PostItem[]>; canWrite: boolean; onCreate: (d: Date) => void; onOpen: (p: PostItem) => void;
}) {
  return (
    <>
      <div className="h-16 border-b border-line pr-3 pl-1 text-right text-sm text-muted tabular-nums">
        <span className={`relative bg-surface px-1 ${hour === 0 ? 'top-1' : '-top-2.5'}`}>{hour}:00</span>
      </div>
      {days.map((d) => {
        const start = slotStart(d, hour);
        const past = isPastSlot(start, now);
        const items = bySlot.get(slotKey(start)) ?? [];
        return (
          <div key={dayKey(d)} className={`group relative h-16 overflow-hidden border-b border-l border-line ${past ? HATCH : ''}`}>
            {!past && canWrite && (
              <button type="button" onClick={() => onCreate(start)} aria-label={`Créer une publication le ${longDay(d)} à ${hour}:00`} className="absolute inset-0 hover:bg-lime-soft/50 focus-visible:bg-lime-soft/60" />
            )}
            <div className="pointer-events-none relative grid grid-cols-[minmax(0,1fr)] gap-0.5 p-0.5">
              {items.slice(0, 2).map((p) => <div key={p.id} className="pointer-events-auto"><Chip post={p} onOpen={onOpen} /></div>)}
              {items.length > 2 && <p className="pointer-events-auto px-1 text-[11px] font-semibold text-muted">+{items.length - 2} autre{items.length - 2 > 1 ? 's' : ''}</p>}
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
  const grid = monthGrid(anchor);
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface">
      <div className="grid min-w-[640px] grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w) => <p key={w} className="border-l border-line px-2 py-2.5 text-center text-sm text-muted first:border-l-0">{w}</p>)}
      </div>
      <div className="grid min-w-[640px] grid-cols-7">
        {grid.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const past = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) <= now;
          const items = byDay.get(dayKey(d)) ?? [];
          const today = sameDay(d, now);
          return (
            <div key={dayKey(d)} className={`relative min-h-[112px] min-w-0 overflow-hidden border-b border-l border-line p-1.5 ${past ? HATCH : ''} ${inMonth ? '' : 'opacity-45'}`}>
              {!past && canWrite && (
                <button type="button" onClick={() => onCreate(defaultTimeForDay(d, now))} aria-label={`Créer une publication le ${longDay(d)}`} className="absolute inset-0 hover:bg-lime-soft/50 focus-visible:bg-lime-soft/60" />
              )}
              <div className="pointer-events-none relative">
                <p className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${today ? 'bg-ink text-white' : 'text-muted'}`}>{d.getDate()}</p>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                  {items.slice(0, 3).map((p) => <div key={p.id} className="pointer-events-auto"><Chip post={p} onOpen={onOpen} /></div>)}
                  {items.length > 3 && <p className="pointer-events-auto px-1 text-[11px] font-semibold text-muted">+{items.length - 3} autre{items.length - 3 > 1 ? 's' : ''}</p>}
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
  const groups = [...groupPosts(posts, 'day').entries()];
  const undated = posts.filter((p) => !p.publishAt);
  if (groups.length === 0 && undated.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface p-10 text-center">
        <div><p className="text-lg font-semibold">Aucune publication</p><p className="mt-1 text-sm text-muted">Cliquez sur un créneau du calendrier pour en créer une.</p></div>
      </div>
    );
  }
  const label = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const day = new Date(y!, m! - 1, d!);
    if (sameDay(day, now)) return 'Aujourd’hui';
    if (sameDay(day, addDays(now, 1))) return 'Demain';
    if (sameDay(day, addDays(now, -1))) return 'Hier';
    return longDay(day);
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
                  <button type="button" onClick={() => onOpen(p)} className="w-full rounded-2xl border border-line bg-paper p-4 text-left transition hover:border-ink/30">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold"><NetworkLabel id={p.networkId} /><span className="font-normal text-muted">· {p.accountName}</span></span>
                      <span className="flex items-center gap-2"><span className="text-sm text-muted tabular-nums">{p.publishAt ? time(p.publishAt) : ''}</span><Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge></span>
                    </span>
                    <span className="mt-2 line-clamp-2 block text-[15px] leading-relaxed">{p.content || <span className="text-subtle">(sans texte)</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {undated.length > 0 && (
          <div>
            <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Sans date</h3>
            <ul className="mt-3 grid gap-2.5">
              {undated.map((p) => (
                <li key={p.id}><button type="button" onClick={() => onOpen(p)} className="w-full rounded-2xl border border-line bg-paper p-4 text-left hover:border-ink/30"><span className="text-sm font-semibold"><NetworkLabel id={p.networkId} /></span><span className="mt-1 line-clamp-2 block text-[15px]">{p.content || '(sans texte)'}</span></button></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function PostDialog({ post, canWrite, onClose }: { post: PostItem; canWrite: boolean; onClose: () => void }) {
  return (
    <Modal title="Publication" onClose={onClose} width="max-w-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><NetworkLabel id={post.networkId} /><span className="font-normal text-muted">· {post.accountName}</span></p>
        <Badge tone={STATE[post.state].tone}>{STATE[post.state].label}</Badge>
      </div>
      {post.publishAt && <p className="mt-2 text-sm text-muted">{new Date(post.publishAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</p>}
      <p className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-paper p-4 text-[15px] leading-relaxed">{post.content || <span className="text-subtle">(sans texte)</span>}</p>
      {post.error && <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{post.error}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {post.releaseUrl ? <a href={post.releaseUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">Voir la publication</a> : <span />}
        {canWrite && DELETABLE.includes(post.state) && (
          <form action={async (fd) => { await deletePostAction(fd); onClose(); }}>
            <input type="hidden" name="groupId" value={post.groupId} />
            <Button type="submit" variant="secondary" size="sm" className="!border-danger/40 !text-danger hover:!bg-danger-soft">Supprimer</Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
