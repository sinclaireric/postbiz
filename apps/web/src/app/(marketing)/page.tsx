import Link from 'next/link';
import { InboxPreview } from '@/components/inbox-preview';
import { Badge, ButtonLink, Container, Eyebrow } from '@/components/ui';
import { NETWORKS } from '@/lib/networks';

const PILLARS = [
  {
    title: 'Publier',
    text: 'Programmez le même contenu vers plusieurs réseaux, avec un aperçu pour chacun, et retrouvez tout dans un calendrier.',
  },
  {
    title: 'Répondre',
    text: 'Messages privés Messenger et Instagram, commentaires Facebook, Instagram et YouTube : une seule liste, une seule zone de réponse.',
  },
  {
    title: 'Collaborer',
    text: 'Assignez une conversation à un collègue, laissez une note interne, gardez des réponses rapides pour les questions fréquentes.',
  },
];

const STEPS = [
  { n: '01', title: 'Connecter', text: 'Autorisez vos comptes en quelques clics. Vos accès sont chiffrés et jamais visibles par votre navigateur.' },
  { n: '02', title: 'Planifier', text: 'Écrivez une fois, choisissez les réseaux et l’heure. Postbiz publie à votre place.' },
  { n: '03', title: 'Répondre', text: 'Les messages et commentaires arrivent en direct dans la boîte de réception, triés par urgence.' },
  { n: '04', title: 'Suivre', text: 'Ouvert, en attente, fermé : chaque conversation a un statut et un responsable.' },
];

const FEATURES: { title: string; text: string; tag: 'beta' | 'soon' }[] = [
  { title: 'Boîte de réception unifiée', text: 'Messages privés et commentaires, mis à jour en temps réel, avec recherche dans tout l’historique.', tag: 'beta' },
  { title: 'Calendrier de publication', text: 'Vue d’ensemble de ce qui part, quand et où. Brouillons, programmés, publiés, erreurs.', tag: 'beta' },
  { title: 'Médiathèque', text: 'Images et vidéos centralisées, adaptées automatiquement aux exigences de chaque réseau.', tag: 'beta' },
  { title: 'Assignation et notes', text: 'Répartissez les conversations dans l’équipe et gardez le contexte sous les yeux.', tag: 'beta' },
  { title: 'Application mobile', text: 'Répondez depuis votre téléphone et recevez une notification à chaque nouveau message.', tag: 'soon' },
  { title: 'Statistiques par réseau', text: 'Quelles publications fonctionnent, à quelle heure, sur quel canal.', tag: 'soon' },
];

const TRUST = [
  { title: 'Isolation par organisation', text: 'Chaque équipe ne voit que ses données : la séparation est appliquée dans la base de données elle-même, pas seulement dans l’interface.' },
  { title: 'Accès aux réseaux protégés', text: 'Les jetons d’accès à vos comptes sont chiffrés avant d’être enregistrés, et ne sont jamais envoyés à votre navigateur.' },
  { title: 'Logiciel libre', text: 'Postbiz est publié sous licence AGPL-3.0 : vous pouvez lire le code, et l’héberger vous-même si vous le souhaitez.' },
];

const FAQ = [
  {
    q: 'Quels réseaux sont pris en charge ?',
    a: 'Facebook, Instagram, X, LinkedIn, TikTok et YouTube pour la publication. Pour la boîte de réception, la couverture dépend de ce que chaque réseau autorise : voir la page Canaux pour le détail réseau par réseau.',
  },
  {
    q: 'Puis-je répondre aux messages privés de LinkedIn ou de YouTube ?',
    a: 'Non, et aucun outil tiers ne le peut sans accord spécial : LinkedIn n’ouvre pas sa messagerie aux applications, et YouTube n’a pas de messages privés. Postbiz affichera les commentaires YouTube, et les commentaires de Pages LinkedIn dès qu’ils seront disponibles.',
  },
  {
    q: 'Pourquoi une « fenêtre de 24 heures » ?',
    a: 'Sur Messenger et Instagram, Meta autorise une entreprise à répondre pendant 24 heures après le dernier message du client. Postbiz affiche le temps restant sur chaque conversation, pour que vous sachiez quoi traiter en premier.',
  },
  {
    q: 'Mes messages servent-ils à entraîner une IA ?',
    a: 'Non. Postbiz n’utilise pas vos messages ni vos publications pour entraîner des modèles.',
  },
  {
    q: 'Combien ça coûte ?',
    a: 'La bêta est gratuite, sans carte bancaire. La grille tarifaire est déjà publique sur la page Tarifs, pour que vous sachiez à quoi vous attendre.',
  },
  {
    q: 'Puis-je héberger Postbiz moi-même ?',
    a: 'Oui. Postbiz est un logiciel libre (AGPL-3.0) construit sur Supabase. Si vous le modifiez et le proposez à des tiers, vous devez publier vos modifications.',
  },
];

function Tag({ tag }: { tag: 'beta' | 'soon' }) {
  return tag === 'beta' ? <Badge tone="lime">Bêta</Badge> : <Badge>Bientôt</Badge>;
}

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
          <div className="flex flex-col justify-center px-5 py-16 sm:px-10 lg:py-24 xl:pl-[max(2.5rem,calc((100vw-1200px)/2+2rem))] xl:pr-16">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="lime">Bêta ouverte</Badge>
              <span className="text-sm text-muted">Logiciel libre · AGPL-3.0</span>
            </div>
            <h1 className="mt-6 text-[clamp(2.5rem,5.2vw,4.25rem)] leading-[1.04] font-semibold tracking-[-0.035em]">
              Planifiez vos posts et répondez à <span className="accent">tous vos messages</span>, au même endroit
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Postbiz relie vos comptes Facebook, Instagram, X, LinkedIn, TikTok et YouTube. Vous programmez vos publications, et les messages et commentaires de vos abonnés arrivent dans une seule boîte de réception, partagée avec votre équipe.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg">Essayer gratuitement</ButtonLink>
              <ButtonLink href="/tarifs" variant="secondary" size="lg">Voir les tarifs</ButtonLink>
            </div>
            <p className="mt-4 text-sm text-subtle">Bêta gratuite · Sans carte bancaire</p>
          </div>
          <div className="pattern-diamonds relative flex min-h-[420px] items-center justify-center overflow-hidden px-5 py-14 sm:px-10 lg:min-h-[640px]">
            <InboxPreview className="w-full max-w-[600px]" />
          </div>
        </div>
      </section>

      {/* TROIS PILIERS */}
      <section className="py-20 sm:py-28">
        <Container>
          <Eyebrow>Un seul outil pour vos réseaux</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
            Ce que vous faites chaque jour sur vos réseaux, <span className="accent">sans changer d’application</span>
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PILLARS.map((p, i) => (
              <article key={p.title} className="flex min-h-[260px] flex-col justify-between rounded-3xl border border-line bg-surface p-7">
                <span className="text-sm font-semibold text-subtle">0{i + 1}</span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight">{p.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{p.text}</p>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* FENÊTRE 24 H */}
      <section className="pattern-diamonds text-white">
        <Container className="grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow className="!text-lime">Messenger et Instagram</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
              La fenêtre de 24 heures, <span className="accent text-lime">sous contrôle</span>
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/80">
              Meta vous laisse 24 heures pour répondre après le dernier message d’un client. Postbiz affiche le temps restant sur chaque conversation et met en avant celles qui vont expirer, pour qu’aucune demande ne tombe dans l’oubli.
            </p>
            <ul className="mt-8 grid gap-3 text-white/90">
              {['Compte à rebours sur chaque conversation', 'Tri par urgence', 'Avertissement avant l’envoi d’une réponse tardive'].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lime text-forest">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m2.5 6.2 2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <InboxPreview />
        </Container>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="py-20 sm:py-28">
        <Container>
          <Eyebrow>Comment ça marche</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
            Prêt en <span className="accent">quelques minutes</span>
          </h2>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-3xl border border-line bg-surface p-6">
                <p className="text-sm font-bold text-forest-2">{s.n}</p>
                <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* FONCTIONNALITÉS */}
      <section className="border-y border-line bg-wash py-20 sm:py-28">
        <Container>
          <Eyebrow>La suite complète</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
            Tout ce qu’il faut pour <span className="accent">gérer vos réseaux</span>, rien de plus
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="bg-surface p-7">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <Tag tag={f.tag} />
                </div>
                <p className="mt-3 leading-relaxed text-muted">{f.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* CANAUX */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <Eyebrow>Canaux</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
              Six réseaux, <span className="accent">en toute transparence</span>
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
              Chaque réseau décide de ce que les outils tiers ont le droit de faire. Nous vous disons clairement ce qui marche aujourd’hui, ce qui arrive, et ce qui n’est pas possible.
            </p>
            <ButtonLink href="/canaux" variant="secondary" className="mt-8">Voir le détail par réseau</ButtonLink>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {NETWORKS.map((n) => (
              <li key={n.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-4">
                <span className="h-3 w-3 rounded-full" style={{ background: n.color }} aria-hidden="true" />
                <span className="font-semibold">{n.name}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* CONFIANCE */}
      <section className="border-y border-line bg-wash py-20 sm:py-28">
        <Container>
          <Eyebrow>Vos données</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
            Vos conversations <span className="accent">restent les vôtres</span>
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {TRUST.map((t) => (
              <article key={t.title} className="rounded-3xl border border-line bg-surface p-7">
                <h3 className="text-lg font-semibold">{t.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{t.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <Eyebrow>Questions fréquentes</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
              Vous vous <span className="accent">demandez</span>
            </h2>
            <p className="mt-4 text-muted">
              Une autre question ? <Link href="/contact" className="font-semibold text-ink underline underline-offset-4">Écrivez-nous</Link>.
            </p>
          </div>
          <div className="divide-y divide-line rounded-3xl border border-line bg-surface">
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
        </Container>
      </section>

      {/* APPEL À L'ACTION */}
      <section className="px-5 pb-20 sm:px-8 sm:pb-28">
        <div className="pattern-diamonds mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] px-6 py-16 text-center text-white sm:px-12 sm:py-24">
          <h2 className="mx-auto max-w-2xl text-[clamp(2rem,4vw,3.25rem)] leading-[1.08] font-semibold tracking-[-0.035em]">
            Commencez à répondre <span className="accent text-lime">sans courir après vos messages</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg text-white/80">Créez votre compte et connectez votre premier canal. Bêta gratuite, sans carte bancaire.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" variant="lime" size="lg">Essayer gratuitement</ButtonLink>
            <ButtonLink href="/contact" variant="secondary" size="lg">Parler à l’équipe</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
