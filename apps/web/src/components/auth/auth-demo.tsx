import { demoLabels } from '@/components/hero/demo-data';
import { HeroDemo } from '@/components/hero/demo-window';
import { getLocale } from '@/i18n/server';

/**
 * Panneau de droite des écrans de connexion et d'inscription : la même démonstration animée que le hero de l'accueil (l'agent
 * crée et programme les publications, le calendrier les montre, puis la boîte de réception commune), en boucle.
 * Décorative : le panneau est déjà masqué aux lecteurs d'écran, donc les onglets ne sont pas cliquables.
 */
export async function AuthDemo() {
  const locale = await getLocale();
  return (
    <HeroDemo
      labels={demoLabels(locale)}
      options={false}
      loop
      compact
      interactive={false}
      start={0.8}
      panelClassName="h-[min(560px,max(440px,calc(100dvh-14rem)))]"
    />
  );
}
