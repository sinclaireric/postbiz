import Link from 'next/link';
import type { MessageKey, T } from '@/i18n/types';

const TABS: { id: 'general' | 'channels'; href: string; label: MessageKey }[] = [
  { id: 'general', href: '/app/reglages', label: 'app.settings.tabs.general' },
  { id: 'channels', href: '/app/canaux', label: 'app.nav.channels' },
];

/** Sections des Paramètres : « Canaux » n'a plus d'entrée dans la barre latérale, on y accède d'ici. */
export function SettingsTabs({ current, t }: { current: 'general' | 'channels'; t: T }) {
  return (
    <nav aria-label={t('app.settings.tabs.label')} className="mb-6 inline-flex rounded-full border border-line bg-surface p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.id} href={tab.href} aria-current={current === tab.id ? 'page' : undefined}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${current === tab.id ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
