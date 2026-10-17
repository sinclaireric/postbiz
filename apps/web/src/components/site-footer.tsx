import Link from 'next/link';
import { getT } from '@/i18n/server';
import { LanguageSwitcher } from './language-switcher';
import { Logo } from './logo';
import { Container } from './ui';

export async function SiteFooter() {
  const t = await getT();
  const columns = [
    {
      title: t('footer.product'),
      links: [
        { href: '/produit/inbox', label: t('footer.inbox') },
        { href: '/produit/planification', label: t('footer.planning') },
        { href: '/canaux', label: t('footer.channels') },
        { href: '/tarifs', label: t('footer.pricing') },
      ],
    },
    {
      title: t('header.agents'),
      links: [
        { href: '/claude', label: 'Claude' },
        { href: '/chatgpt', label: 'ChatGPT' },
        { href: '/claude-code', label: 'Claude Code' },
        { href: '/cursor', label: 'Cursor' },
        { href: '/mcp', label: t('header.mcp') },
        { href: '/agent', label: t('header.agentsAll') },
      ],
    },
    {
      title: t('footer.resources'),
      links: [
        { href: '/blog', label: t('footer.blog') },
        { href: '/contact', label: t('footer.contact') },
        { href: '/signup', label: t('footer.createAccount') },
        { href: '/login', label: t('footer.signIn') },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { href: '/cgu', label: t('footer.terms') },
        { href: '/confidentialite', label: t('footer.privacy') },
        { href: '/suppression-des-donnees', label: t('footer.dataDeletion') },
      ],
    },
  ];

  return (
    <footer className="border-t border-line bg-paper">
      <Container className="grid gap-10 py-14 sm:grid-cols-3 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div className="sm:col-span-3 lg:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">{t('footer.tagline')}</p>
          <div className="mt-5 -ms-3"><LanguageSwitcher variant="text" /></div>
        </div>
        {columns.map((c) => (
          <div key={c.title}>
            <p className="text-sm font-semibold">{c.title}</p>
            <ul className="mt-4 grid gap-2.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted hover:text-ink">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="flex flex-col gap-2 border-t border-line py-6 text-sm text-subtle sm:flex-row sm:justify-between">
        <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        <p>{t('footer.trademarks')}</p>
      </Container>
    </footer>
  );
}
