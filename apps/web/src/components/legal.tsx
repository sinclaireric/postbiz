import type { ReactNode } from 'react';
import { Container } from './ui';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-3 text-sm text-subtle">Dernière mise à jour : {updated}</p>
      <div className="mt-6 rounded-2xl border border-warn/30 bg-warn-soft px-5 py-4 text-sm leading-relaxed text-warn">
        <strong>Projet de texte.</strong> Ce document est un modèle de départ : les passages entre crochets [ ] sont à compléter et l’ensemble doit être relu par un juriste avant la mise en production.
      </div>
      <div className="mt-10 grid gap-10 text-[16px] leading-relaxed text-ink/90 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:grid [&_ul]:gap-1.5 [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </Container>
  );
}

export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@postbiz.com';
