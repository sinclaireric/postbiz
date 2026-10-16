'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { formatRelative } from '@/lib/inbox/logic';
import type { NotificationItem } from '@/lib/data/types';
import { NavIcon } from './nav-icons';

export function NotificationsMenu({ notifications, markRead }: { notifications: NotificationItem[]; markRead: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label={unread > 0 ? `Notifications (${unread} non lues)` : 'Notifications'} className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink/70 hover:bg-wash hover:text-ink">
        <NavIcon name="bell" size={20} />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_-15px_rgba(17,17,16,0.35)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" disabled={pending} onClick={() => start(async () => { await markRead(); })} className="text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50">Tout marquer comme lu</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Aucune notification.</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto">
              {notifications.map((n) => {
                const body = (
                  <>
                    <span className="flex items-start justify-between gap-3">
                      <span className={`text-sm ${n.read ? 'font-medium' : 'font-bold'}`}>{n.title}</span>
                      <span className="shrink-0 text-xs text-subtle">{formatRelative(n.createdAt)}</span>
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm leading-snug text-muted">{n.body}</span>}
                  </>
                );
                return (
                  <li key={n.id} className={`border-b border-line last:border-0 ${n.read ? '' : 'bg-lime-soft/40'}`}>
                    {n.href ? <Link href={n.href} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-wash">{body}</Link> : <div className="px-4 py-3">{body}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
