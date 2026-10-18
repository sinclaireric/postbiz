import { LOCALE_META, type Locale } from '@/i18n/config';
import type { MessageKey } from '@/i18n/types';
import { socialName, type SocialId } from '@/components/social-icon';
import type { Network } from '@/lib/networks';

/** Option choisie au-dessus de la fenêtre : qui programme les publications. */
export type Scenario = 'agent' | 'manual';
/** Onglets de l'application montrés dans la fenêtre (les mêmes que le rail de la vraie application). */
export type Tab = 'agent' | 'calendar' | 'inbox';

/**
 * Enchaînement de chaque option : l'onglet joué, puis la durée de sa scène avant de passer au suivant (secondes, hors délai
 * de démarrage). Un onglet sans suivant (l'inbox) reste affiché.
 */
export const FLOW: Record<Scenario, { tab: Tab; seconds: number }[]> = {
  agent: [{ tab: 'agent', seconds: 11.6 }, { tab: 'calendar', seconds: 7.4 }, { tab: 'inbox', seconds: 0 }],
  manual: [{ tab: 'calendar', seconds: 13.4 }, { tab: 'inbox', seconds: 0 }],
};

/** Déroulé en boucle (écran d'inscription) : agent, calendrier, inbox, puis on repart de l'agent. */
export const LOOP_FLOW: { tab: Tab; seconds: number }[] = [
  { tab: 'agent', seconds: 11.6 },
  { tab: 'calendar', seconds: 7.4 },
  { tab: 'inbox', seconds: 11.4 },
];

/** Conversations de la liste (la première est celle qui s'ouvre). Noms propres et pseudos : jamais traduits. */
export interface DemoThread {
  name: string;
  initials: string;
  tone: string;
  /** Logo affiché (fichier de public/socials/) : Messenger pour les messages privés Facebook, Facebook pour ses commentaires. */
  logo: SocialId;
  preview: MessageKey;
  unread?: boolean;
}

export const logoName = socialName;

export const THREADS: DemoThread[] = [
  { name: 'Camille Roux', initials: 'CR', tone: '#dbe8ff', logo: 'instagram', preview: 'home.demo.m2', unread: true },
  { name: 'Atelier Nova', initials: 'AN', tone: '#ffe1d6', logo: 'facebook', preview: 'home.demo.p2', unread: true },
  { name: 'Thomas Bernard', initials: 'TB', tone: '#dff3e4', logo: 'whatsapp', preview: 'home.demo.p7' },
  { name: '@lea.mercier', initials: 'LM', tone: '#e3f5ec', logo: 'x', preview: 'home.demo.p3' },
  { name: 'Julien Petit', initials: 'JP', tone: '#fdf1da', logo: 'tiktok', preview: 'home.demo.p4' },
  { name: 'Studio Ondine', initials: 'SO', tone: '#ece6ff', logo: 'youtube', preview: 'home.demo.p5' },
  { name: 'Marion Leroy', initials: 'ML', tone: '#ffdfe9', logo: 'messenger', preview: 'home.demo.p6' },
];

/**
 * Publications de la semaine. Seuls les réseaux où la publication fonctionne aujourd'hui y figurent (Facebook, X, LinkedIn).
 * Option « agent » : l'agent crée les trois premières (0, 1, 2). Option « manuelle » : on crée la deuxième (1) à la main.
 */
export const POSTS: { day: number; network: Network['id']; title: MessageKey; only?: Scenario }[] = [
  { day: 0, network: 'linkedin', title: 'home.demo.post1' },
  { day: 1, network: 'facebook', title: 'home.demo.post2' },
  { day: 2, network: 'x', title: 'home.demo.post3' },
  { day: 3, network: 'facebook', title: 'home.demo.post4' },
  { day: 4, network: 'x', title: 'home.demo.post5' },
  // Le même texte, programmé aussi sur X : le composeur manuel choisit deux canaux (Facebook et X).
  { day: 1, network: 'x', title: 'home.demo.post2', only: 'manual' },
];
export const NEW_POSTS: Record<Scenario, number[]> = { agent: [0, 1, 2], manual: [1, 5] };

/** Dates et heures déjà mises en forme pour la langue (calculées côté serveur : le rendu est identique dans le navigateur). */
export interface DemoLabels {
  rowTimes: string[];
  postTimes: string[];
  /** Jour et heure de chaque publication, pour les cartes du chat (« lun. 19 · 9:00 »). */
  postWhen: string[];
  range: string;
  /** Date proposée par défaut dans le composeur, puis celle qu'on choisit. */
  defaultDate: string;
  chosenDate: string;
  days: { weekday: string; day: string }[];
}

const hm = (h: number, m: number) => Date.UTC(2026, 9, 19, h, m);
const POST_TIMES: [number, number][] = [[9, 0], [12, 30], [8, 15], [18, 0], [10, 0], [12, 30]];

export function demoLabels(locale: Locale): DemoLabels {
  const tag = LOCALE_META[locale].tag;
  const time = new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
  const day = new Intl.DateTimeFormat(tag, { day: 'numeric', timeZone: 'UTC' });
  const numeric = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const full = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const yesterday = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(-1, 'day');
  const dayAt = (i: number) => Date.UTC(2026, 9, 19 + i, 12);
  const postTimes = POST_TIMES.map(([h, m]) => time.format(hm(h, m)));
  return {
    rowTimes: [time.format(hm(17, 0)), time.format(hm(14, 32)), time.format(hm(12, 15)), time.format(hm(11, 8)), yesterday, yesterday, weekday.format(Date.UTC(2026, 9, 12, 12))],
    postTimes,
    postWhen: POSTS.map((p, i) => `${weekday.format(dayAt(p.day))} ${day.format(dayAt(p.day))} · ${postTimes[i]}`),
    range: numeric.formatRange(dayAt(0), dayAt(6)),
    defaultDate: full.format(Date.UTC(2026, 9, 17, 20, 0)),
    chosenDate: full.format(Date.UTC(2026, 9, 20, 12, 30)),
    // Semaine du lundi 19 au dimanche 25 octobre 2026.
    days: Array.from({ length: 7 }, (_, i) => ({ weekday: weekday.format(dayAt(i)), day: day.format(dayAt(i)) })),
  };
}
