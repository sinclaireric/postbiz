'use client';

import type { ReactNode } from 'react';
import { useT } from '@/i18n/client';
import { splitRich, type RichPart } from '@/i18n/translate';
import { AGENTS, LOGO_SPACER, RotatingAgent } from './rotating-agent';

const plain = (parts: RichPart[]): ReactNode[] => parts.map((p, i) => <span key={i} className="contents">{typeof p === 'string' ? p : p.text}</span>);

/**
 * Titre du hero : le message `home.title` contient `<agent>libellé générique</agent>`, remplacé par le mot qui change.
 *
 * Le mot change de largeur, donc la phrase peut se recouper et décaler tout ce qui est dessous. Deux parades :
 * - le mot termine la phrase (français, anglais, espagnol…) : on le met toujours sur sa propre ligne ;
 * - du texte le suit (japonais, coréen, chinois, turc, vietnamien) : on réserve la hauteur de la plus haute des versions,
 *   en superposant des copies invisibles de la phrase, une par mot, dans la même cellule de grille.
 */
export function HeroTitle({ className = '' }: { className?: string }) {
  const t = useT();
  const parts = splitRich(t.raw('home.title'));
  const at = parts.findIndex((p) => typeof p !== 'string' && p.tag === 'agent');
  if (at < 0) return <h1 className={className}>{plain(parts)}</h1>;

  const before = parts.slice(0, at);
  const after = parts.slice(at + 1);
  const generic = (parts[at] as { tag: string; text: string }).text;
  const trailing = after.every((p) => typeof p === 'string' && p.trim() === '');

  if (trailing) {
    return (
      <h1 className={className}>
        {plain(before)}
        <br />
        <RotatingAgent generic={generic} />
      </h1>
    );
  }

  return (
    <h1 className={`grid ${className}`}>
      <span className="col-start-1 row-start-1">
        {plain(before)}<RotatingAgent generic={generic} />{plain(after)}
      </span>
      {[{ name: generic, logo: false }, ...AGENTS.map((a) => ({ name: a.name, logo: true }))].map((word) => (
        <span key={word.name} aria-hidden="true" className="pointer-events-none invisible col-start-1 row-start-1 select-none">
          {plain(before)}
          <span className="accent inline-flex items-center gap-[0.17em] whitespace-nowrap">
            {word.logo && <span className={LOGO_SPACER} />}
            {word.name}
          </span>
          {plain(after)}
        </span>
      ))}
    </h1>
  );
}
