'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { switchWorkspaceAction } from '@/app/app/(shell)/workspace-actions';
import { useT } from '@/i18n/client';

/** Un espace de travail tel que l'affichent le sélecteur et le menu du compte. */
export interface WorkspaceOption {
  id: string;
  name: string;
  roleLabel: string;
  current: boolean;
}

export interface WorkspaceMenuProps {
  workspaces: WorkspaceOption[];
  /** Peut-on en créer un autre ? (Il faut administrer au moins un espace.) */
  canCreate: boolean;
  /** Invitations reçues et pas encore traitées. */
  invitations: number;
}

const SETTINGS_SPACES = '/app/reglages#espaces';

/** Lettre dans un carré : l'identité visuelle d'un espace. */
export function WorkspaceBadge({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-lg bg-lime-soft text-[13px] font-bold text-forest uppercase">
      {[...name.trim()][0] ?? '·'}
    </span>
  );
}

/**
 * Les espaces de la personne, un bouton chacun. Chaque bouton envoie un formulaire à `switchWorkspaceAction`, qui vérifie l'appartenance côté serveur :
 * la page d'où l'on part (`from`) ne sert qu'à rester dans la même section.
 */
export function WorkspaceItems({ workspaces, onPick }: { workspaces: WorkspaceOption[]; onPick?: () => void }) {
  const pathname = usePathname();
  return (
    <ul role="group" className="grid gap-0.5">
      {workspaces.map((w) => (
        <li key={w.id}>
          <form action={switchWorkspaceAction}>
            <input type="hidden" name="orgId" value={w.id} />
            <input type="hidden" name="from" value={pathname} />
            <button
              type="submit"
              role="menuitemradio"
              aria-checked={w.current}
              // Fermer le menu tout de suite le retirerait de la page avant l'envoi du formulaire (qui part après le clic) : on attend la fin du clic.
              onClick={w.current ? (e) => { e.preventDefault(); onPick?.(); } : () => { if (onPick) setTimeout(onPick, 0); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-wash ${w.current ? 'bg-wash/70' : ''}`}
            >
              <WorkspaceBadge name={w.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{w.name}</span>
                <span className="block truncate text-xs text-muted">{w.roleLabel}</span>
              </span>
              {w.current && <span aria-hidden="true" className="text-forest">✓</span>}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

/** Liens du bas de la liste : créer un espace, gérer ses espaces, répondre à une invitation. */
export function WorkspaceLinks({ canCreate, invitations, onPick }: Pick<WorkspaceMenuProps, 'canCreate' | 'invitations'> & { onPick?: () => void }) {
  const t = useT();
  const link = 'flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium hover:bg-wash';
  return (
    <div className="grid gap-0.5">
      {invitations > 0 && (
        <Link href="/app/reglages#invitations" onClick={onPick} role="menuitem" className={link}>
          <span>{t('app.workspace.menu.invitations')}</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-bold text-white">{invitations}</span>
        </Link>
      )}
      {canCreate && <Link href={SETTINGS_SPACES} onClick={onPick} role="menuitem" className={link}>{t('app.workspace.menu.create')}</Link>}
      <Link href={SETTINGS_SPACES} onClick={onPick} role="menuitem" className={link}>{t('app.workspace.menu.manage')}</Link>
    </div>
  );
}

/** Le sélecteur de l'en-tête : le nom de l'espace courant, et la liste des autres au clic. */
export function WorkspaceSwitcher({ workspaces, canCreate, invitations }: WorkspaceMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = workspaces.find((w) => w.current) ?? workspaces[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!current) return null;
  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${t('app.workspace.menu.label')} : ${current.name}`}
        className="flex h-10 max-w-[200px] items-center gap-2 rounded-xl border border-line bg-surface ps-1.5 pe-2.5 text-sm font-semibold hover:bg-wash sm:max-w-[260px]"
      >
        <WorkspaceBadge name={current.name} />
        <span className="min-w-0 truncate">{current.name}</span>
        {invitations > 0 && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ink" />}
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label={t('app.workspace.menu.title')} className="absolute start-0 z-40 mt-2 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_-15px_rgba(17,17,16,0.35)]">
          <p className="border-b border-line px-4 py-3 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('app.workspace.menu.title')}</p>
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            <WorkspaceItems workspaces={workspaces} onPick={() => setOpen(false)} />
          </div>
          <div className="border-t border-line p-1.5">
            <WorkspaceLinks canCreate={canCreate} invitations={invitations} onPick={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
