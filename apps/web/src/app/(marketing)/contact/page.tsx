import type { Metadata } from 'next';
import { CONTACT_EMAIL } from '@/components/legal';
import { ButtonLink, Container, Eyebrow } from '@/components/ui';

export const metadata: Metadata = { title: 'Contact', description: 'Écrivez à l’équipe Postbiz.' };

export default function ContactPage() {
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <Eyebrow>Contact</Eyebrow>
      <h1 className="mt-3 text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
        Parlons de <span className="accent">votre besoin</span>
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-muted">
        Une question, un réseau à suggérer, un besoin spécifique : écrivez-nous, nous répondons en général sous un jour ouvré.
      </p>
      <div className="mt-10 rounded-3xl border border-line bg-surface p-8">
        <p className="text-sm font-semibold text-muted">Par e-mail</p>
        <a href={`mailto:${CONTACT_EMAIL}`} className="mt-1 block text-2xl font-semibold tracking-tight underline decoration-lime decoration-4 underline-offset-4">{CONTACT_EMAIL}</a>
        <p className="mt-6 text-muted">Pour un bug, indiquez le réseau concerné et l’heure approximative : cela nous fait gagner un temps précieux.</p>
        <ButtonLink href="/signup" className="mt-8">Créer un compte</ButtonLink>
      </div>
    </Container>
  );
}
