import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingPlans } from '@/components/pricing-table';
import { Container, Eyebrow } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Tarifs',
  description: 'Les tarifs de Postbiz : trois offres, une remise de 20 % à l’année. La bêta est gratuite, sans carte bancaire.',
};

type Cell = boolean | string;
const ROWS: { label: string; hint?: string; values: [Cell, Cell, Cell] }[] = [
  { label: 'Canaux connectés', values: ['3', '10', 'Illimités'] },
  { label: 'Membres de l’équipe', values: ['1', '5', '15'] },
  { label: 'Planification et calendrier', values: [true, true, true] },
  { label: 'Boîte de réception unifiée', values: [true, true, true] },
  { label: 'Application mobile', hint: 'Bientôt', values: [true, true, true] },
  { label: 'Assignation et notes internes', values: [false, true, true] },
  { label: 'Réponses rapides', values: [false, true, true] },
  { label: 'Notifications push', hint: 'Bientôt', values: [false, true, true] },
  { label: 'Recherche dans tout l’historique', values: [false, true, true] },
  { label: 'Rôles et permissions', values: [false, false, true] },
  { label: 'Optimisation automatique des vidéos', values: [false, false, true] },
  { label: 'Support prioritaire', values: [false, false, true] },
];

const FAQ = [
  { q: 'La bêta est-elle vraiment gratuite ?', a: 'Oui. Pendant la bêta, tous les plans sont gratuits et aucune carte bancaire n’est demandée. Les prix ci-dessus sont ceux que nous prévoyons d’appliquer ; nous vous préviendrons bien avant tout changement.' },
  { q: 'Puis-je changer de plan ?', a: 'À tout moment. Les fonctionnalités du plan supérieur sont disponibles immédiatement.' },
  { q: 'Que se passe-t-il si je dépasse le nombre de canaux ?', a: 'Vous ne pouvez pas connecter de canal supplémentaire tant que vous n’avez pas changé de plan. Vos canaux existants continuent de fonctionner.' },
  { q: 'Les messages privés sont-ils inclus partout ?', a: 'Oui, dans la limite de ce que chaque réseau autorise. Consultez la page Canaux pour le détail.' },
];

function Mark({ v }: { v: Cell }) {
  if (v === true) return <svg className="mx-auto text-forest-2" width="16" height="16" viewBox="0 0 14 14" fill="none" aria-label="Inclus"><path d="m2.5 7.3 2.8 2.8 6-6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (v === false) return <span className="text-subtle" aria-label="Non inclus">—</span>;
  return <span className="font-semibold">{v}</span>;
}

export default function PricingPage() {
  return (
    <>
      <section className="pt-16 pb-6 sm:pt-24">
        <Container className="text-center">
          <Eyebrow>Tarifs</Eyebrow>
          <h1 className="mx-auto mt-3 max-w-3xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
            Des tarifs simples, <span className="accent">publiés dès la bêta</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted">Trois offres selon la taille de votre équipe. Tout est gratuit pendant la bêta, sans carte bancaire.</p>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <PricingPlans />
        </Container>
      </section>

      <section className="border-y border-line bg-wash py-20">
        <Container>
          <h2 className="text-[clamp(1.7rem,3vw,2.4rem)] font-semibold tracking-[-0.03em]">Comparer les offres</h2>
          <div className="mt-8 overflow-x-auto rounded-3xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-[15px]">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-6 py-4 font-medium text-muted"><span className="sr-only">Fonctionnalité</span></th>
                  {['Starter', 'Pro', 'Équipe'].map((n) => <th key={n} scope="col" className="px-4 py-4 text-center font-semibold">{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-line last:border-0">
                    <th scope="row" className="px-6 py-4 font-medium">
                      {r.label}
                      {r.hint && <span className="ml-2 rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-muted">{r.hint}</span>}
                    </th>
                    {r.values.map((v, i) => <td key={i} className="px-4 py-4 text-center"><Mark v={v} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-3xl">
          <h2 className="text-[clamp(1.7rem,3vw,2.4rem)] font-semibold tracking-[-0.03em]">Questions sur les tarifs</h2>
          <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-surface">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-6 py-5">
                <summary className="flex items-center justify-between gap-4 text-[17px] font-semibold">
                  {f.q}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-wash transition group-open:rotate-45" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-muted">Une autre question ? <Link href="/contact" className="font-semibold text-ink underline underline-offset-4">Contactez-nous</Link>.</p>
        </Container>
      </section>
    </>
  );
}
