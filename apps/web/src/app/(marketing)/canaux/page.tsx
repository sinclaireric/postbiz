import type { Metadata } from 'next';
import { Badge, ButtonLink, Container, Eyebrow } from '@/components/ui';
import { CAPABILITY_LABEL, NETWORKS, type Capability } from '@/lib/networks';

export const metadata: Metadata = {
  title: 'Canaux',
  description: 'Ce que Postbiz sait faire sur Facebook, Instagram, X, LinkedIn, TikTok et YouTube : publication, messages privés, commentaires.',
};

function Cap({ c }: { c: Capability }) {
  return <Badge tone={c === 'beta' ? 'lime' : 'neutral'}>{CAPABILITY_LABEL[c]}</Badge>;
}

export default function ChannelsPage() {
  return (
    <>
      <section className="pt-16 pb-12 sm:pt-24">
        <Container>
          <Eyebrow>Canaux</Eyebrow>
          <h1 className="mt-3 max-w-3xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
            Ce qui marche, ce qui arrive, <span className="accent">et ce qui n’est pas possible</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            Chaque réseau décide de ce que les outils tiers ont le droit de faire. Plutôt que de promettre une boîte de réception « universelle », voici l’état réel, réseau par réseau.
          </p>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <div className="overflow-x-auto rounded-3xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-sm text-muted">
                  <th scope="col" className="px-6 py-4 font-medium">Réseau</th>
                  <th scope="col" className="px-4 py-4 font-medium">Publier</th>
                  <th scope="col" className="px-4 py-4 font-medium">Messages privés</th>
                  <th scope="col" className="px-4 py-4 font-medium">Commentaires</th>
                  <th scope="col" className="px-6 py-4 font-medium">À savoir</th>
                </tr>
              </thead>
              <tbody>
                {NETWORKS.map((n) => (
                  <tr key={n.id} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="px-6 py-5">
                      <span className="flex items-center gap-3 text-[17px] font-semibold">
                        <span className="h-3 w-3 rounded-full" style={{ background: n.color }} aria-hidden="true" />
                        {n.name}
                      </span>
                    </th>
                    <td className="px-4 py-5"><Cap c={n.publish} /></td>
                    <td className="px-4 py-5"><Cap c={n.dm} /></td>
                    <td className="px-4 py-5"><Cap c={n.comments} /></td>
                    <td className="px-6 py-5 text-[15px] leading-relaxed text-muted">{n.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-subtle">« Bêta » : disponible pour les testeurs. « Bientôt » : prévu, sous réserve de l’accès accordé par le réseau.</p>
        </Container>
      </section>

      <section className="border-t border-line bg-wash py-20">
        <Container className="grid gap-6 md:grid-cols-3">
          {[
            { t: 'Pourquoi pas tous les messages ?', d: 'LinkedIn et YouTube ne donnent pas accès aux messages privés aux applications tierces. Nous ne contournons pas ces règles : cela mettrait vos comptes en danger.' },
            { t: 'Pourquoi cette fenêtre de 24 heures ?', d: 'C’est une règle de Meta pour Messenger et Instagram. Postbiz affiche le temps restant pour chaque conversation.' },
            { t: 'Un réseau manque ?', d: 'Dites-nous lequel et pourquoi : nos priorités suivent ce que vous utilisez réellement.' },
          ].map((x) => (
            <article key={x.t} className="rounded-3xl border border-line bg-surface p-7">
              <h2 className="text-lg font-semibold">{x.t}</h2>
              <p className="mt-3 leading-relaxed text-muted">{x.d}</p>
            </article>
          ))}
        </Container>
      </section>

      <section className="py-20 text-center">
        <Container>
          <h2 className="text-[clamp(1.8rem,3.4vw,2.6rem)] font-semibold tracking-[-0.03em]">Connectez votre premier canal</h2>
          <div className="mt-7 flex justify-center gap-3">
            <ButtonLink href="/signup" size="lg">Essayer gratuitement</ButtonLink>
            <ButtonLink href="/contact" variant="secondary" size="lg">Suggérer un réseau</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
