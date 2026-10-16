'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { Container } from '@/components/ui';

type Mode = 'agentic' | 'classic';

const VIDEOS: Record<Mode, string> = {
  agentic: '/videos/hero-agentic.webm',
  classic: '/videos/hero.webm',
};

/**
 * Démonstration vidéo sous le hero : une bascule choisit entre la planification « agentique » et la planification classique.
 * Une seule vidéo est chargée à la fois (l'autre ne l'est qu'au premier basculement) ; elle ne joue que lorsqu'elle est visible,
 * et jamais d'elle-même pour qui demande moins d'animations (les commandes du lecteur apparaissent alors).
 */
export function ProductShowcase() {
  const t = useT();
  const [mode, setMode] = useState<Mode>('agentic');
  const [reduced, setReduced] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // `key={mode}` remonte l'élément vidéo à chaque bascule : on rebranche donc l'observateur.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;
    video.muted = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.25 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [mode, reduced]);

  const label = (m: Mode, text: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`rounded-md px-1 text-center font-medium transition-colors ${mode === m ? 'text-white' : 'text-white/55 hover:text-white/85'}`}
    >
      {text}
    </button>
  );

  return (
    <Container className="py-8 sm:py-12">
      <div role="group" aria-label={t('home.showcase.switchLabel')} className="flex flex-col items-center gap-3 text-[15px] sm:flex-row sm:justify-center sm:gap-5 sm:text-lg">
        {label('agentic', t('home.showcase.agentic'))}
        {/* Interrupteur décoratif : les deux boutons de texte portent l'état pour le clavier et les lecteurs d'écran. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setMode(mode === 'agentic' ? 'classic' : 'agentic')}
          className="flex h-7 w-12 shrink-0 rounded-full bg-white/15 p-1 ring-1 ring-white/20"
        >
          <span className={`h-5 w-5 rounded-full bg-lime transition-[margin] duration-200 ${mode === 'agentic' ? 'ms-0' : 'ms-5'}`} />
        </button>
        {label('classic', t('home.showcase.classic'))}
      </div>

      <div className="relative mt-6 aspect-[1920/1018] w-full overflow-hidden rounded-2xl bg-forest sm:mt-8 sm:rounded-[2rem]">
        <video
          key={mode}
          ref={videoRef}
          src={VIDEOS[mode]}
          muted
          loop
          playsInline
          preload="metadata"
          controls={reduced}
          disablePictureInPicture
          aria-label={t(mode === 'agentic' ? 'home.showcase.videoAgentic' : 'home.showcase.videoClassic')}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </Container>
  );
}
