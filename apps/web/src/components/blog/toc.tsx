'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface TocItem {
  id: string;
  text: string;
}

/**
 * Sommaire collant de l'article, comme celui de Chatbase : la liste des titres, avec un repère qui glisse vers le titre
 * en cours de lecture. Sans JavaScript, c'est une simple liste de liens d'ancre.
 */
export function Toc({ title, items, itemAttrs }: { title: string; items: TocItem[]; itemAttrs?: { lang?: string; dir?: 'ltr' | 'rtl' } }) {
  const [active, setActive] = useState(0);
  const [mark, setMark] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Titre en cours = le dernier dont le haut est passé sous l'en-tête collant.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = 0;
      items.forEach((item, i) => {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= 140) current = i;
      });
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items]);

  useLayoutEffect(() => {
    const li = listRef.current?.children[active] as HTMLElement | undefined;
    setMark(li ? li.offsetTop + li.offsetHeight / 2 : null);
  }, [active, items]);

  return (
    <nav aria-label={title}>
      <p className="text-sm font-semibold tracking-[0.14em] text-muted uppercase">{title}</p>
      <div className="relative mt-5">
        <span aria-hidden="true" className="absolute inset-y-0 start-px w-0.5 rounded-full bg-line" />
        <span
          aria-hidden="true"
          className="absolute start-0 top-0 h-5 w-1 rounded-full bg-lime transition-[transform,opacity] duration-200 ease-out"
          style={{ transform: `translateY(${(mark ?? 0) - 10}px)`, opacity: mark === null ? 0 : 1 }}
        />
        <ol ref={listRef} {...itemAttrs} className="relative grid gap-2 ps-4">
          {items.map((item, i) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={i === active ? 'location' : undefined}
                className={`line-clamp-2 block text-sm leading-5 transition-colors ${i === active ? 'font-medium text-ink' : 'text-muted hover:text-ink'}`}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
