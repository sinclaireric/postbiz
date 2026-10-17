import Link from 'next/link';
import type { ReactNode } from 'react';
import { AI_AGENTS } from '@/lib/agents';
import { ButtonLink, Container } from '../ui';

export const SECTION_H2 = 'text-[clamp(1.8rem,3.4vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance';

/** Questions fréquentes en accordéon, sans JavaScript (<details>). */
export function Faq({ items }: { items: { q: string; a: string; lang?: string }[] }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {items.map((item) => (
        <details key={item.q} className="group px-5 py-1 sm:px-6">
          <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 text-base font-semibold sm:text-lg">
            {item.q}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-180">
              <path d="m3.5 6 4.5 4.5L12.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <p lang={item.lang} className="pb-5 leading-relaxed text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/** Grille des agents : icône, nom, lien vers sa page. `except` retire l'agent de la page courante. */
export function AgentGrid({ except, soon }: { except?: string; soon?: string }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {AI_AGENTS.filter((a) => a.slug !== except).map((a) => (
        <li key={a.slug}>
          <Link href={`/${a.slug}`} className="flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-ink/30 hover:bg-wash">
            {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
            <img src={a.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[27%]" loading="lazy" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">{a.name}</span>
              {soon && <span className="block text-xs text-subtle">{soon}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Bandeau final : panneau vert à losanges, titre (avec mot mis en valeur), texte et bouton. */
export function EndBand({ title, text, button, href = '/signup' }: { title: ReactNode; text: string; button: string; href?: string }) {
  return (
    <Container className="pb-20 sm:pb-28">
      <section className="pattern-diamonds overflow-hidden rounded-[2rem] px-7 py-14 text-center text-white sm:px-12 sm:py-20">
        <h2 className="mx-auto max-w-2xl text-[clamp(1.9rem,4vw,3rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-balance">{title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-white/80">{text}</p>
        <ButtonLink href={href} variant="lime" size="lg" className="mt-8">{button}</ButtonLink>
      </section>
    </Container>
  );
}

/** Pastille d'état : « Disponible » en vert, « Bientôt » en neutre, « Bêta » en citron. */
export function StatusPill({ tone, children }: { tone: 'ok' | 'soon' | 'beta'; children: ReactNode }) {
  const styles = { ok: 'bg-ok-soft text-ok', soon: 'bg-wash text-muted', beta: 'bg-lime-soft text-forest' } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}
