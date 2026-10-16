import type { ReactNode } from 'react';
import { splitRich, type Params } from '@/i18n/translate';
import type { MessageKey, T } from '@/i18n/types';

type Tags = Record<string, (text: string) => ReactNode>;

/**
 * Affiche un message contenant des balises, par exemple « Une question ? <link>Écrivez-nous</link> », en remplaçant chaque
 * balise par un composant : `<RichText t={t} k="home.faq.more" tags={{ link: (text) => <Link href="/contact">{text}</Link> }} />`.
 * Fonctionne dans les composants serveur et clients.
 */
export function RichText({ t, k, params, tags }: { t: T; k: MessageKey; params?: Params; tags: Tags }) {
  return (
    <>
      {splitRich(t.raw(k, params)).map((part, i) =>
        typeof part === 'string' ? part : <span key={i} className="contents">{tags[part.tag] ? tags[part.tag]!(part.text) : part.text}</span>
      )}
    </>
  );
}

/** Mot mis en valeur dans un titre (serif italique pour les écritures latines, gras pour les autres : voir globals.css). */
export const accentTags: Tags = { accent: (text) => <span className="accent">{text}</span> };
export const accentLimeTags: Tags = { accent: (text) => <span className="accent text-lime">{text}</span> };
export const boldTags: Tags = { b: (text) => <strong>{text}</strong> };
