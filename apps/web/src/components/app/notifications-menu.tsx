'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useT } from '@/i18n/client';
import { formatRelative } from '@/i18n/format';
import type { MessageKey } from '@/i18n/types';
import type { NotificationItem } from '@/lib/data/types';
import { NavIcon } from './nav-icons';

const TYPE_TITLE: Record<string, MessageKey> = {
  post_error: 'app.notifications.types.post_error',
  post_unknown: 'app.notifications.types.post_unknown',
  message_failed: 'app.notifications.types.message_failed',
};

export function NotificationsMenu({ notifications, markRead }: { notifications: NotificationItem[]; markRead: () => Promise<void> }) {
  const t = useT();
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
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label={unread > 0 ? t('app.notifications.labelUnread', { count: unread }) : t('app.notifications.label')} className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink/70 hover:bg-wash hover:text-ink">
        <NavIcon name="bell" size={20} />
        {unread > 0 && <span className="absolute top-1.5 end-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-40 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_-15px_rgba(17,17,16,0.35)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">{t('app.notifications.title')}</p>
            {unread > 0 && (
              <button type="button" disabled={pending} onClick={() => start(async () => { await markRead(); })} className="text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50">{t('app.notifications.markAll')}</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{t('app.notifications.empty')}</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto">
              {notifications.map((n) => {
                // Le titre est traduit d'après le type ; le détail vient du serveur (worker) et garde sa langue d'origine.
                const titleKey = TYPE_TITLE[n.type];
                const body = (
                  <>
                    <span className="flex items-start justify-between gap-3">
                      <span className={`text-sm ${n.read ? 'font-medium' : 'font-bold'}`}>{titleKey ? t(titleKey) : n.title}</span>
                      <span className="shrink-0 text-xs text-subtle">{formatRelative(t.locale, n.createdAt)}</span>
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
