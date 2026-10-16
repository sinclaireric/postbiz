import Link from 'next/link';
import { Logo } from './logo';
import { ButtonLink, Container } from './ui';

const PRODUCT_LINKS = [
  { href: '/produit/inbox', title: 'Boîte de réception', desc: 'Messages privés et commentaires de tous vos réseaux.' },
  { href: '/produit/planification', title: 'Planification', desc: 'Un calendrier pour publier partout, à l’heure.' },
  { href: '/canaux', title: 'Canaux', desc: 'Ce que Postbiz sait faire sur chaque réseau.' },
];

const LINKS = [
  { href: '/canaux', label: 'Canaux' },
  { href: '/tarifs', label: 'Tarifs' },
  { href: '/contact', label: 'Contact' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            <div className="group relative">
              <button className="flex h-10 items-center gap-1 rounded-full px-3 text-[15px] font-medium text-ink/80 hover:text-ink" aria-haspopup="true">
                Produit
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <div className="invisible absolute left-0 top-full w-[340px] pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                <div className="rounded-2xl border border-line bg-surface p-2 shadow-[0_12px_40px_-12px_rgba(17,17,16,0.25)]">
                  {PRODUCT_LINKS.map((l) => (
                    <Link key={l.href} href={l.href} className="block rounded-xl p-3 hover:bg-wash">
                      <span className="block text-[15px] font-semibold">{l.title}</span>
                      <span className="block text-sm text-muted">{l.desc}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="flex h-10 items-center rounded-full px-3 text-[15px] font-medium text-ink/80 hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="/login" variant="ghost" size="sm">Connexion</ButtonLink>
          <ButtonLink href="/signup" size="sm">Essai gratuit</ButtonLink>
        </div>

        {/* Menu mobile sans JavaScript */}
        <details className="relative md:hidden">
          <summary className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface" aria-label="Ouvrir le menu">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </summary>
          <div className="absolute right-0 top-12 w-[280px] rounded-2xl border border-line bg-surface p-3 shadow-[0_12px_40px_-12px_rgba(17,17,16,0.3)]">
            {[...PRODUCT_LINKS.map((l) => ({ href: l.href, label: l.title })), { href: '/tarifs', label: 'Tarifs' }, { href: '/contact', label: 'Contact' }].map((l) => (
              <Link key={l.href} href={l.href} className="block rounded-xl px-3 py-2.5 text-[15px] font-medium hover:bg-wash">{l.label}</Link>
            ))}
            <div className="mt-2 grid gap-2 border-t border-line pt-3">
              <ButtonLink href="/login" variant="secondary" size="sm">Connexion</ButtonLink>
              <ButtonLink href="/signup" size="sm">Essai gratuit</ButtonLink>
            </div>
          </div>
        </details>
      </Container>
    </header>
  );
}
