'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NavIcon, type NavIconName } from '@/components/app/nav-icons';
import { LogoMark } from '@/components/logo';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';
import { FLOW, LOOP_FLOW, type DemoLabels, type Scenario, type Tab } from './demo-data';
import { AgentScene, CalendarScene, CursorArrow, InboxScene } from './demo-scenes';

/** Délai avant la première scène : le cadre arrive à 0,8 s (voir globals.css) et met 1 s à se poser. Ensuite, quasi immédiat. */
const FIRST_START = 1.5;
const RESTART = 0.3;

/** Le rail de la vraie application (components/app/shell.tsx). Seuls les trois premiers onglets se jouent. */
const RAIL: { tab?: Tab; icon: NavIconName; label: MessageKey; dim?: boolean }[] = [
  { tab: 'calendar', icon: 'calendar', label: 'app.nav.calendar' },
  { tab: 'inbox', icon: 'inbox', label: 'app.nav.inbox' },
  { tab: 'agent', icon: 'agent', label: 'app.nav.agent' },
  { icon: 'analytics', label: 'app.nav.analytics', dim: true },
  { icon: 'media', label: 'app.nav.media' },
  { icon: 'channels', label: 'app.nav.channels' },
];
const TABS: Tab[] = ['calendar', 'inbox', 'agent'];

const vars = (v: Record<string, string | number>) => v as CSSProperties;

/**
 * Démonstration de l'application dans le hero, sur le modèle de x.ai/bot : une fenêtre dont les messages arrivent un à un.
 *
 * Deux options (au-dessus) : « planification par agent IA » (par défaut) puis « manuelle ». Chacune joue son déroulé dans
 * l'onglet qui convient (Agent : le chat ; Calendrier : les publications ou le composeur), puis passe à l'Inbox. Les onglets
 * du rail se cliquent : la scène choisie se joue seule, sans enchaîner. Tout est décoratif (aria-hidden, inert) : un texte
 * caché décrit la scène aux lecteurs d'écran. Les animations sont en CSS ; seul l'enchaînement des onglets passe par un minuteur.
 */
interface HeroDemoProps {
  labels: DemoLabels;
  /** Affiche la bascule « agent IA / manuelle » au-dessus de la fenêtre (le hero) ; sinon, seule l'option agent est jouée. */
  options?: boolean;
  /** Rejoue le déroulé sans fin (agent → calendrier → inbox → agent…) au lieu de s'arrêter sur l'inbox. */
  loop?: boolean;
  /** Fenêtre étroite : cinq jours au calendrier, pas de liste de conversations. */
  compact?: boolean;
  /** Onglets cliquables. Faux : tout est décoratif (écran d'inscription, dont le panneau est déjà masqué aux lecteurs d'écran). */
  interactive?: boolean;
  /** Délai avant la première scène (secondes). */
  start?: number;
  /** Classes de taille de la fenêtre. */
  panelClassName?: string;
}

export function HeroDemo({ labels, options = true, loop = false, compact = false, interactive = true, start = FIRST_START, panelClassName = 'h-[580px] md:h-[640px]' }: HeroDemoProps) {
  const t = useT();
  const [scenario, setScenario] = useState<Scenario>('agent');
  const [tab, setTab] = useState<Tab>('agent');
  const [auto, setAuto] = useState(true);
  // Change à chaque (re)lancement d'une scène : elle est remontée, donc ses animations repartent de zéro.
  const [epoch, setEpoch] = useState(0);
  const [reduced, setReduced] = useState(false);
  // Tant que la fenêtre n'est pas apparue à l'écran (sur mobile elle est sous la ligne de flottaison), les animations restent
  // en pause ; quand elle apparaît, la scène repart de zéro. Rendue côté serveur sans pause : sans JavaScript, elle se joue au chargement.
  const panel = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const lead = epoch === 0 ? start : RESTART;
  // Onglet suivant du déroulé : un curseur va le cliquer juste avant le changement de scène (on le voit « aller sur le calendrier »).
  const steps = loop ? LOOP_FLOW : FLOW[scenario];
  const stepIndex = steps.findIndex((s) => s.tab === tab);
  const followingStep = loop ? steps[(stepIndex + 1) % steps.length] : steps[stepIndex + 1];
  const nextTab = auto && !reduced ? followingStep?.tab : undefined;
  const sceneLength = steps[stepIndex]?.seconds ?? 0;
  const [nav, setNav] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = panel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let first = true;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry || seen.current) return;
      if (entry.isIntersecting) {
        seen.current = true;
        if (!first) setEpoch((n) => n + 1);
        setWaiting(false);
        observer.disconnect();
      } else if (first) {
        setWaiting(true);
        setEpoch((n) => n + 1);
      }
      first = false;
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Position du curseur de navigation : le centre de l'onglet visé, et d'où il part (le milieu de la scène), en coordonnées de la fenêtre.
  useEffect(() => {
    const place = () => {
      const root = panel.current;
      const target = nextTab ? document.getElementById(`hero-nav-${nextTab}`) : null;
      const content = document.getElementById('hero-demo-content');
      if (!root || !target || !content) return setNav(null);
      const r = root.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      const x = b.left + b.width / 2 - r.left;
      const y = b.top + b.height / 2 - r.top;
      setNav({ x, y, sx: c.left + c.width / 2 - r.left - x, sy: c.top + c.height * 0.6 - r.top - y });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [nextTab, epoch]);

  // Enchaînement automatique : à la fin de la scène, on passe à l'onglet suivant du déroulé (agent → calendrier → inbox).
  useEffect(() => {
    if (!auto || waiting || reduced) return;
    const step = steps[stepIndex];
    const next = loop ? steps[(stepIndex + 1) % steps.length] : steps[stepIndex + 1];
    if (!step || !next) return;
    const id = window.setTimeout(() => {
      setTab(next.tab);
      setEpoch((n) => n + 1);
    }, (lead + step.seconds) * 1000);
    return () => window.clearTimeout(id);
  }, [auto, waiting, reduced, loop, steps, stepIndex, epoch, lead]);

  const chooseScenario = (next: Scenario) => {
    setScenario(next);
    setTab(FLOW[next][0]!.tab);
    setAuto(true);
    setEpoch((n) => n + 1);
  };
  const chooseTab = (next: Tab) => {
    setTab(next);
    setAuto(false);
    setEpoch((n) => n + 1);
  };
  const onRailKey = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    chooseTab(next);
    document.getElementById(`hero-nav-${next}`)?.focus();
  };

  // Les libellés peuvent passer sur deux lignes : la grille leur donne chacun la moitié de la place restante,
  // quelle que soit la largeur du cadre et la langue, sans jamais déborder.
  const option = (s: Scenario, text: string, align: string) => (
    <button
      type="button"
      aria-pressed={scenario === s}
      onClick={() => chooseScenario(s)}
      className={`rounded-md px-1 font-medium leading-snug transition-colors ${align} ${scenario === s ? 'text-ink' : 'text-muted hover:text-ink'}`}
    >
      {text}
    </button>
  );

  const description: MessageKey = tab === 'agent' ? 'home.demo.descAgent' : tab === 'inbox' ? 'home.demo.descInbox' : scenario === 'manual' ? 'home.demo.descManual' : 'home.demo.descCalendar';
  const scene = tab === 'agent' ? <AgentScene labels={labels} /> : tab === 'inbox' ? <InboxScene labels={labels} compact={compact} /> : <CalendarScene labels={labels} scenario={scenario} compact={compact} />;

  return (
    <div {...(interactive ? { role: 'region', 'aria-label': t('home.demo.regionLabel') } : { 'aria-hidden': true, inert: true })}>
      {options && (
      <div role="group" aria-label={t('home.showcase.switchLabel')} className="mx-auto mb-5 grid max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm sm:gap-4 sm:text-base">
        {option('agent', t('home.showcase.agentic'), 'text-end')}
        {/* Interrupteur décoratif : les deux boutons de texte portent l'état pour le clavier et les lecteurs d'écran. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => chooseScenario(scenario === 'agent' ? 'manual' : 'agent')}
          className="flex h-7 w-12 shrink-0 rounded-full bg-wash p-1 ring-1 ring-line"
        >
          <span className={`h-5 w-5 rounded-full bg-forest transition-[margin] duration-200 ${scenario === 'agent' ? 'ms-0' : 'ms-5'}`} />
        </button>
        {option('manual', t('home.demo.optManual'), 'text-start')}
      </div>
      )}

      <div
        ref={panel}
        id="hero-demo-panel"
        className={`relative flex flex-col gap-2 overflow-hidden rounded-3xl bg-wash p-2 text-start text-ink shadow-[0_40px_90px_-50px_rgba(17,17,16,0.45)] ring-1 ring-line md:flex-row ${panelClassName}`}
      >
        {/* Rail d'onglets de l'application (en barre sur mobile). */}
        <nav
          {...(interactive ? { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': t('app.nav.label'), onKeyDown: onRailKey } : {})}
          className="flex shrink-0 items-center justify-around gap-1 rounded-2xl border border-line bg-surface p-1.5 md:w-[84px] md:flex-col md:justify-start md:p-2 md:pt-3"
        >
          <span className="mb-3 hidden md:block" aria-hidden="true"><LogoMark size={36} /></span>
          {RAIL.map((item) => {
            const body = (
              <>
                <NavIcon name={item.icon} size={20} />
                <span className="max-w-full truncate">{t(item.label)}</span>
              </>
            );
            if (!item.tab) {
              return (
                <span key={item.icon} aria-hidden="true" className={`hidden w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium md:flex ${item.dim ? 'text-ink/30' : 'text-ink/60'}`}>{body}</span>
              );
            }
            const active = tab === item.tab;
            const pressing = item.tab === nextTab;
            const Item = interactive ? 'button' : 'span';
            return (
              <Item
                key={item.tab}
                id={`hero-nav-${item.tab}`}
                {...(interactive
                  ? { type: 'button' as const, role: 'tab', 'aria-selected': active, 'aria-controls': 'hero-demo-content', tabIndex: active ? 0 : -1, onClick: () => chooseTab(item.tab!) }
                  : {})}
                className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors md:w-full md:flex-none ${active ? 'bg-lime-soft text-forest' : `text-ink/60 ${interactive ? 'hover:bg-wash hover:text-ink' : ''}`}`}
              >
                {/* L'onglet que le curseur va cliquer « s'enfonce » : l'élément est remonté à chaque scène pour rejouer l'animation. */}
                <span
                  key={pressing ? epoch : 'idle'}
                  data-paused={pressing ? waiting : undefined}
                  className={`flex max-w-full flex-col items-center gap-1 ${pressing ? 'demo demo-press' : ''}`}
                  style={pressing ? vars({ '--t0': `${lead}s`, '--d': `${sceneLength - 0.55}s` }) : undefined}
                >
                  {body}
                </span>
                {item.tab === 'inbox' && <span aria-hidden="true" className="absolute end-1/4 top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white md:end-2.5">1</span>}
              </Item>
            );
          })}
        </nav>

        <div id="hero-demo-content" {...(interactive ? { role: 'tabpanel', 'aria-labelledby': `hero-nav-${tab}` } : {})} className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          {interactive && <p className="sr-only">{t(description)}</p>}
          <div
            key={`${scenario}-${tab}-${epoch}`}
            aria-hidden="true"
            inert
            data-paused={waiting}
            className="demo flex min-h-0 flex-1 flex-col rtl:[--dir:-1] rtl:[--rtl:1]"
            style={vars({ '--t0': `${lead}s` })}
          >
            {scene}
          </div>
        </div>

        {nextTab && nav && (
          <div
            key={`${scenario}-${tab}-${epoch}`}
            data-paused={waiting}
            className="demo pointer-events-none absolute z-30 h-0 w-0"
            style={{ left: nav.x, top: nav.y, ...vars({ '--t0': `${lead}s` }) }}
            aria-hidden="true"
          >
            <div className="demo-cursor h-0 w-0" style={vars({ '--d': `${sceneLength - 1.9}s`, '--sx': `${nav.sx}px`, '--sy': `${nav.sy}px` })}>
              <CursorArrow label={t('home.demo.you')} mirror={false} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
