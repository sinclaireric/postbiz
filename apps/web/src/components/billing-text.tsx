'use client';

import Link from 'next/link';
import { RichText } from '@/components/rich-text';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';

const tags = { link: (text: string) => <Link href="/app/facturation" className="underline underline-offset-2">{text}</Link> };

/**
 * Un message de l'application qui peut renvoyer vers la page Facturation par une balise <link> (quota d'IA atteint, limite de l'offre atteinte). Un message sans balise
 * s'affiche tel quel : on peut donc l'employer pour toute une table de messages d'erreur.
 */
export function BillingText({ k, params }: { k: MessageKey; params?: Record<string, string | number> }) {
  const t = useT();
  return <RichText t={t} k={k} params={params} tags={tags} />;
}
