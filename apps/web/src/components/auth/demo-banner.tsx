import Link from 'next/link';
import { isDemo } from '@/lib/supabase/env';

export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div className="mb-6 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
      <strong>Mode démo.</strong> Supabase n’est pas configuré : la connexion est désactivée.{' '}
      <Link href="/app" className="font-semibold underline underline-offset-4">Ouvrir l’application de démonstration →</Link>
    </div>
  );
}
