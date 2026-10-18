import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthDemo } from '@/components/auth/auth-demo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Logo } from '@/components/logo';
import { RichText } from '@/components/rich-text';
import { getT } from '@/i18n/server';

/** Mot en valeur du titre du panneau : insécable, pour que la fin de la phrase ne se coupe pas entre deux lignes. */
const asideTags = { accent: (text: string) => <span className="accent whitespace-nowrap text-lime">{text}</span> };

/** Écran partagé : formulaire à gauche, panneau de marque à droite (masqué sur mobile). */
export async function AuthShell({
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
  const t = await getT();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col bg-paper px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between gap-3">
          <Logo />
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted">
              {switchLabel && <span className="hidden sm:inline">{switchLabel} </span>}
              <Link href={switchHref} className="font-semibold text-ink underline underline-offset-4">{switchText}</Link>
            </p>
            <LanguageSwitcher />
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-2 text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </main>

        <footer className="flex items-center justify-between text-sm text-subtle">
          <p>© {new Date().getFullYear()} Postbiz</p>
          <p className="flex gap-5">
            <Link href="/cgu" className="hover:text-ink">{t('auth.termsLink')}</Link>
            <Link href="/confidentialite" className="hover:text-ink">{t('auth.privacyLink')}</Link>
          </p>
        </footer>
      </div>

      <aside className="pattern-diamonds relative hidden items-center justify-center overflow-hidden p-10 lg:flex" aria-hidden="true">
        <div className="w-full max-w-[640px]">
          <p className="mb-6 max-w-[34rem] text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-wrap text-white">
            <RichText t={t} k="auth.asideTitle" tags={asideTags} />
          </p>
          <AuthDemo />
        </div>
      </aside>
    </div>
  );
}
