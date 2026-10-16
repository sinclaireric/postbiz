'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export function UserMenu({ name, email, orgName, role, signOutAction }: { name: string; email: string; orgName: string; role: string; signOutAction: () => Promise<void> }) {
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
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label="Menu du compte" className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
        {(name || email).slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-[260px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_-15px_rgba(17,17,16,0.35)]">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-subtle">{email}</p>
            <p className="mt-2 truncate text-xs text-muted">{orgName} · {role}</p>
          </div>
          <div className="p-1.5">
            <Link href="/app/reglages" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm font-medium hover:bg-wash" role="menuitem">Paramètres</Link>
            <form action={signOutAction}>
              <button type="submit" className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-wash" role="menuitem">Se déconnecter</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
