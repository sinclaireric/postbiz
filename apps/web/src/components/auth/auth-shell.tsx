import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { InboxPreview } from '@/components/inbox-preview';

/** Écran partagé : formulaire à gauche, panneau de marque à droite (masqué sur mobile). */
export function AuthShell({
  title,
  subtitle,
  switchLabel,
  switchHref,
  switchText,
  children,
}: {
  title: string;
  subtitle: string;
  switchLabel: string;
  switchHref: string;
  switchText: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col bg-paper px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between">
          <Logo />
          <p className="text-sm text-muted">
            <span className="hidden sm:inline">{switchLabel} </span>
            <Link href={switchHref} className="font-semibold text-ink underline underline-offset-4">{switchText}</Link>
          </p>
        </header>

        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-2 text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </main>

        <footer className="flex items-center justify-between text-sm text-subtle">
          <p>© {new Date().getFullYear()} Postbiz</p>
          <p className="flex gap-5">
            <Link href="/cgu" className="hover:text-ink">Conditions</Link>
            <Link href="/confidentialite" className="hover:text-ink">Confidentialité</Link>
          </p>
        </footer>
      </div>

      <aside className="pattern-diamonds relative hidden items-center justify-center overflow-hidden p-10 lg:flex" aria-hidden="true">
        <div className="w-full max-w-[560px]">
          <p className="mb-6 max-w-md text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-white">
            Une seule boîte pour <span className="accent text-lime">tous vos messages</span>
          </p>
          <InboxPreview />
        </div>
      </aside>
    </div>
  );
}
