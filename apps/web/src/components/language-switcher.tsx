'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setLocaleAction } from '@/app/actions/locale';
import { Modal } from '@/components/app/modal';
import { Flag } from '@/components/flags';
import { LOCALES, LOCALE_META, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/client';

/**
 * Bouton + fenêtre « Changer de langue » (grille de drapeaux, comme dans Postiz).
 * `variant="icon"` : drapeau seul (en-têtes) ; `variant="text"` : drapeau et nom de la langue (pieds de page).
 */
export function LanguageSwitcher({ variant = 'icon', className = '' }: { variant?: 'icon' | 'text'; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const current = LOCALE_META[t.locale];

  const choose = (locale: Locale) => {
    start(async () => {
      await setLocaleAction(locale);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t('common.language.current', { name: current.name })}
        title={t('common.language.button')}
        className={`flex items-center gap-2 rounded-full text-sm font-medium text-ink/80 hover:bg-wash hover:text-ink ${variant === 'icon' ? 'h-10 w-10 justify-center' : 'h-9 px-3'} ${className}`}
      >
        <Flag code={current.flag} />
        {variant === 'text' && <span>{current.name}</span>}
      </button>

      {open && (
        <Modal title={t('common.language.title')} onClose={() => setOpen(false)} width="max-w-3xl">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-busy={pending}>
            {LOCALES.map((l) => {
              const meta = LOCALE_META[l];
              const selected = l === t.locale;
              return (
                <li key={l}>
                  <button
                    type="button"
                    lang={meta.tag}
                    dir={meta.dir}
                    disabled={pending}
                    aria-pressed={selected}
                    onClick={() => choose(l)}
                    className={`flex h-[104px] w-full flex-col items-center justify-center gap-3 rounded-xl border bg-wash text-[17px] transition hover:bg-line/60 disabled:opacity-60 ${selected ? 'border-ink font-bold' : 'border-transparent'}`}
                  >
                    <Flag code={meta.flag} className="!h-6 !w-9" />
                    {meta.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </>
  );
}
