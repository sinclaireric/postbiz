'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Agents affichés dans le titre, avec leur logo (public/agents/). Noms de marque : jamais traduits.
 * Le libellé générique (« vos agents IA ») vient du message du titre et n'a pas de logo.
 */
export const AGENTS = [
  { name: 'Claude', logo: '/agents/claude.svg' },
  { name: 'ChatGPT', logo: '/agents/chatgpt.svg' },
  { name: 'Claude Code', logo: '/agents/claude-code.svg' },
  { name: 'OpenClaw', logo: '/agents/openclaw.svg' },
  { name: 'Hermes Agent', logo: '/agents/hermes.svg' },
  { name: 'Grok Bot', logo: '/agents/grok-bot.svg' },
] as const;

/** Place d'un logo (taille et écart), pour réserver la même largeur sans charger l'image. */
export const LOGO_SPACER = 'inline-block h-[0.8em] w-[0.8em] shrink-0';
const GAP = 'gap-[0.17em]';

const DURATION = 600;
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

type Word = { label: string; logo?: string };

/**
 * Mot qui change dans le titre du hero, à la manière de postiz.com : le libellé générique puis chaque agent (logo + nom)
 * glissent vers le haut à tour de rôle, la largeur s'ajustant au mot affiché.
 *
 * - Rendu serveur, sans JavaScript et avec « moins d'animations » : le libellé générique seul, en texte normal.
 * - Les lecteurs d'écran ne lisent que le libellé générique ; les mots qui défilent (et leurs logos) sont masqués.
 * - Un mot plus large que le titre (libellé long en allemand ou en arabe sur mobile) sort de la rotation.
 */
export function RotatingAgent({ generic, agents = AGENTS, interval = 2800 }: { generic: string; agents?: readonly { name: string; logo: string }[]; interval?: number }) {
  const words: Word[] = [{ label: generic }, ...agents.map((a) => ({ label: a.name, logo: a.logo }))];
  const wordsKey = words.map((w) => w.label).join('\u0000');
  const rootRef = useRef<HTMLSpanElement>(null);
  const probeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [reduced, setReduced] = useState(false);
  const [layout, setLayout] = useState<{ widths: number[]; usable: number[] } | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Mesure la largeur de chaque mot (cachés, dans la même police), puis à chaque redimensionnement ou chargement de police.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduced) { setLayout(null); return; }
    const container = root.closest('h1') ?? root.parentElement ?? root;
    const measure = () => {
      const available = container.clientWidth;
      const widths = probeRefs.current.map((el) => Math.ceil(el?.getBoundingClientRect().width ?? 0));
      const usable = widths.map((w, i) => (w > 0 && w <= available ? i : -1)).filter((i) => i >= 0);
      setStep(0);
      setLayout(usable.length > 1 ? { widths, usable } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [reduced, wordsKey]);

  useEffect(() => {
    if (!layout) return;
    const id = window.setInterval(() => { if (!document.hidden) setStep((s) => s + 1); }, interval);
    return () => window.clearInterval(id);
  }, [layout, interval]);

  const n = layout?.usable.length ?? 0;
  const current = layout ? step % n : 0;
  const currentWord = layout ? layout.usable[current]! : 0;

  return (
    <span
      ref={rootRef}
      className="accent relative inline-block"
      style={{
        // Barre citron sous le mot ; le clip-path coupe les mots qui glissent (en haut et en bas) sans toucher à la ligne de base.
        backgroundImage: 'linear-gradient(var(--color-lime), var(--color-lime))',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 0.13em',
        backgroundPosition: '0 96%',
        ...(layout ? { clipPath: 'inset(-0.12em -0.3em)', width: layout.widths[currentWord], transition: `width ${DURATION}ms ${EASE}` } : {}),
      }}
    >
      {layout ? (
        <>
          <span className="sr-only">{generic}</span>
          {/* Mot courant invisible, dans le flux (texte seul) : donne sa hauteur et sa ligne de base à l'ensemble. */}
          <span aria-hidden="true" className="invisible whitespace-nowrap">{words[currentWord]!.label}</span>
          {layout.usable.map((wordIndex, k) => {
            const rel = (k - current + n) % n;
            const state = rel === 0 ? 'active' : rel === n - 1 ? 'leaving' : 'waiting';
            const word = words[wordIndex]!;
            return (
              <span
                key={wordIndex}
                aria-hidden="true"
                className={`absolute top-0 flex items-center whitespace-nowrap ${GAP}`}
                style={{
                  insetInlineStart: 0,
                  opacity: state === 'active' ? 1 : 0,
                  transform: `translateY(${state === 'active' ? 0 : state === 'leaving' ? -100 : 100}%)`,
                  transition: `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}`,
                }}
              >
                {word.logo && <img src={word.logo} alt="" width={23} height={23} draggable={false} className={`${LOGO_SPACER} select-none`} />}
                {word.label}
              </span>
            );
          })}
        </>
      ) : generic}
      {/* Sondes de mesure : invisibles, hors flux ; une place vide remplace chaque logo pour ne pas le charger deux fois. */}
      <span aria-hidden="true" className="pointer-events-none invisible absolute top-0 whitespace-nowrap" style={{ insetInlineStart: 0 }}>
        {words.map((w, i) => (
          <span key={w.label} ref={(el) => { probeRefs.current[i] = el; }} className={`absolute top-0 flex items-center whitespace-nowrap ${GAP}`} style={{ insetInlineStart: 0 }}>
            {w.logo && <span className={LOGO_SPACER} />}
            {w.label}
          </span>
        ))}
      </span>
    </span>
  );
}
