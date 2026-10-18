'use client';

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/i18n/client';
import { splitRich, type RichPart } from '@/i18n/translate';
import { tokenize, type Token } from './hero/words';
import { AGENTS, LOGO_SPACER, RotatingAgent } from './rotating-agent';

const plain = (parts: RichPart[]): ReactNode[] => parts.map((p, i) => <span key={i} className="contents">{typeof p === 'string' ? p : p.text}</span>);

/** Mots du titre, chacun dans son `.hero-word` : ils apparaissent l'un après l'autre au chargement (voir globals.css). */
function Words({ tokens, offset }: { tokens: Token[]; offset: number }) {
  return (
    <>
      {tokens.map((token, i) => (
        <Fragment key={i}>
          {token.space ? ' ' : null}
          <span className={`hero-word ${token.accent ? 'accent' : ''}`} style={{ '--i': offset + i } as CSSProperties}>{token.text}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Titre du hero : le message `home.title` contient `<agent>libellé générique</agent>`, remplacé par le mot qui change. Les mots du
 * titre apparaissent un à un au chargement ; le mot qui change est le dernier à entrer, comme une unité.
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
  const base = `hero-title ${className}`;
  if (at < 0) return <h1 className={base}><Words tokens={tokenize(parts, t.locale)} offset={0} /></h1>;

  const before = parts.slice(0, at);
  const after = parts.slice(at + 1);
  const beforeWords = tokenize(before, t.locale);
  const afterWords = tokenize(after, t.locale);
  const generic = (parts[at] as { tag: string; text: string }).text;
  const trailing = after.every((p) => typeof p === 'string' && p.trim() === '');
  const lastBefore = before[before.length - 1];
  const spaceBeforeSlot = typeof lastBefore === 'string' && /\s$/.test(lastBefore);
  const slot = (
    <span className="hero-word" style={{ '--i': beforeWords.length } as CSSProperties}>
      <RotatingAgent generic={generic} />
    </span>
  );

  if (trailing) {
    return (
      <h1 className={base}>
        <Words tokens={beforeWords} offset={0} />
        <br />
        {slot}
      </h1>
    );
  }

  return (
    <h1 className={`grid ${base}`}>
      <span className="col-start-1 row-start-1">
        <Words tokens={beforeWords} offset={0} />
        {spaceBeforeSlot ? ' ' : null}
        {slot}
        <Words tokens={afterWords} offset={beforeWords.length + 1} />
      </span>
      {[{ name: generic, logo: false }, ...AGENTS.map((a) => ({ name: a.name, logo: true }))].map((word) => (
        <span key={word.name} aria-hidden="true" className="pointer-events-none invisible col-start-1 row-start-1 select-none">
          {plain(before)}
          <span className={`${word.logo ? '' : 'accent '}inline-flex items-center gap-[0.17em] whitespace-nowrap`}>
            {word.logo && <span className={LOGO_SPACER} />}
            {word.name}
          </span>
          {plain(after)}
        </span>
      ))}
    </h1>
  );
}
