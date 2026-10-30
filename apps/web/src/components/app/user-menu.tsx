'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { WorkspaceItems, WorkspaceLinks, type WorkspaceMenuProps } from './workspace-menu';

export function UserMenu({ name, email, signOutAction, adminLink, workspaces, canCreate, invitations }: { name: string; email: string; signOutAction: () => Promise<void>; adminLink?: { href: string; label: string } } & WorkspaceMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label={t('app.userMenu.label')} className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
        {(name || email).slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-40 mt-2 w-[min(300px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_-15px_rgba(17,17,16,0.35)]">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-subtle" dir="ltr">{email}</p>
          </div>
          <div className="border-b border-line p-1.5">
            <p className="px-3 pt-1 pb-1.5 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('app.workspace.menu.title')}</p>
            <WorkspaceItems workspaces={workspaces} onPick={() => setOpen(false)} />
            <WorkspaceLinks canCreate={canCreate} invitations={invitations} onPick={() => setOpen(false)} />
          </div>
          <div className="p-1.5">
            <Link href="/app/reglages" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm font-medium hover:bg-wash" role="menuitem">{t('app.userMenu.settings')}</Link>
            {adminLink && <Link href={adminLink.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm font-medium hover:bg-wash" role="menuitem">{adminLink.label}</Link>}
            <form action={signOutAction}>
              <button type="submit" className="block w-full rounded-xl px-3 py-2 text-start text-sm font-medium hover:bg-wash" role="menuitem">{t('app.userMenu.signOut')}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
