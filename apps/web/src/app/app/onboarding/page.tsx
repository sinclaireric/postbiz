import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/logo';
import { getSession } from '@/lib/data';
import { OnboardingForm } from './form';

export const metadata: Metadata = { title: 'Bienvenue' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSession();
  if (session.status === 'anonymous') redirect('/login');
  if (session.status === 'ready') redirect('/app/inbox');

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-5 py-12">
      <Logo href="/" />
      <div className="mt-10 w-full max-w-md rounded-3xl border border-line bg-surface p-8">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">Bienvenue sur Postbiz</h1>
        <p className="mt-2 text-muted">Une organisation regroupe vos canaux, vos publications et votre équipe. Vous pourrez inviter des collègues ensuite.</p>
        <div className="mt-7"><OnboardingForm /></div>
      </div>
    </div>
  );
}
