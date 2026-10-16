import type { Metadata } from 'next';
import { ProductPage } from '@/components/product-page';

export const metadata: Metadata = {
  title: 'Planification des publications',
  description: 'Programmez vos publications sur Facebook, Instagram, X, LinkedIn, TikTok et YouTube depuis un seul calendrier.',
};

function CalendarVisual() {
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  const items: Record<string, { t: string; c: string }[]> = {
    Lun: [{ t: '09:00 · Instagram', c: '#e1306c' }],
    Mar: [{ t: '12:30 · LinkedIn', c: '#0a66c2' }, { t: '18:00 · X', c: '#111110' }],
    Mer: [],
    Jeu: [{ t: '10:00 · Facebook', c: '#1877f2' }],
    Ven: [{ t: '17:00 · YouTube', c: '#ff0000' }, { t: '19:00 · TikTok', c: '#fe2c55' }],
  };
  return (
    <div className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)]" role="img" aria-label="Aperçu du calendrier de publication sur une semaine.">
      <div className="border-b border-line bg-wash px-4 py-2.5 text-xs font-medium text-subtle">Calendrier · semaine type</div>
      <div className="grid grid-cols-5 gap-px bg-line text-[12px]">
        {days.map((d) => (
          <div key={d} className="min-h-[230px] bg-surface p-2.5">
            <p className="font-semibold text-muted">{d}</p>
            <div className="mt-2 grid gap-1.5">
              {items[d]!.map((i) => (
                <p key={i.t} className="rounded-lg border border-line bg-paper px-2 py-1.5 leading-tight font-medium">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: i.c }} />
                  {i.t}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlanningProductPage() {
  return (
    <ProductPage
      eyebrow="Planification"
      title={<>Écrivez une fois, <span className="accent">publiez partout</span></>}
      intro="Choisissez vos réseaux, l’heure, et laissez Postbiz publier à votre place. Un calendrier montre ce qui part, quand, et ce qui a échoué."
      visual={<CalendarVisual />}
      points={[
        { title: 'Un contenu, plusieurs réseaux', text: 'Adaptez le texte par réseau si besoin, et vérifiez les contraintes (longueur, médias) avant l’envoi.' },
        { title: 'Jamais de doublon', text: 'Si le résultat d’une publication est incertain, Postbiz ne la renvoie pas tout seul : il vous l’indique, pour que vous vérifiiez d’abord sur le réseau.' },
        { title: 'Médias adaptés', text: 'Images et vidéos sont converties aux exigences de chaque réseau avant la publication.' },
        { title: 'Brouillons et états clairs', text: 'Brouillon, programmé, en cours, publié, erreur : vous savez toujours où en est chaque publication.' },
        { title: 'Travail d’équipe', text: 'Les membres préparent, les administrateurs valident ; les droits sont appliqués par la base de données.' },
        { title: 'Reconnexion guidée', text: 'Si l’accès à un compte expire, vous êtes prévenu et vous reconnectez en un clic.' },
      ]}
      ctaTitle="Programmez votre semaine en dix minutes"
    />
  );
}
