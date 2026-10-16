import Link from 'next/link';
import { RichText, boldTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';
import { isDemo } from '@/lib/supabase/env';

export async function DemoBanner() {
  if (!isDemo) return null;
  const t = await getT();
  return (
    <div className="mb-6 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
      <RichText
        t={t}
        k="auth.demoBanner"
        tags={{ ...boldTags, link: (x) => <Link href="/app/calendrier?onboarding=true" className="font-semibold underline underline-offset-4">{x}</Link> }}
      />
    </div>
  );
}
