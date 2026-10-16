import Link from 'next/link';
import { Logo } from './logo';
import { Container } from './ui';

const COLUMNS = [
  {
    title: 'Produit',
    links: [
      { href: '/produit/inbox', label: 'Boîte de réception' },
      { href: '/produit/planification', label: 'Planification' },
      { href: '/canaux', label: 'Canaux' },
      { href: '/tarifs', label: 'Tarifs' },
    ],
  },
  {
    title: 'Ressources',
    links: [
      { href: '/contact', label: 'Contact' },
      { href: '/signup', label: 'Créer un compte' },
      { href: '/login', label: 'Connexion' },
    ],
  },
  {
    title: 'Légal',
    links: [
      { href: '/cgu', label: 'Conditions d’utilisation' },
      { href: '/confidentialite', label: 'Confidentialité' },
      { href: '/suppression-des-donnees', label: 'Suppression des données' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            Planifiez vos publications et répondez à tous vos messages et commentaires depuis une seule boîte.
          </p>
        </div>
        {COLUMNS.map((c) => (
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
        <p>© {new Date().getFullYear()} Postbiz. Logiciel libre sous licence AGPL-3.0.</p>
        <p>Facebook, Instagram, X, LinkedIn, TikTok et YouTube sont des marques de leurs propriétaires.</p>
      </Container>
    </footer>
  );
}
