import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResendConfirmation } from '@/components/auth/resend-confirmation';
import { getT } from '@/i18n/server';
import { SIGNUP_EMAIL_COOKIE } from '@/lib/auth-callback';
import { validateEmail } from '@/lib/auth-validation';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.verify.title') };
}

/**
 * Après l'inscription par e-mail : l'utilisateur doit ouvrir le lien reçu (comme l'écran « Activate your account » de Postiz).
 * L'adresse vient d'un cookie posé par l'inscription ; sans lui, on revient au formulaire.
 */
export default async function VerificationPage() {
  const email = (await cookies()).get(SIGNUP_EMAIL_COOKIE)?.value ?? '';
  if (validateEmail(email)) redirect('/signup');
  const t = await getT();
  return (
    <AuthShell title={t('auth.verify.title')} subtitle={t('auth.verify.subtitle')} switchLabel={t('auth.signup.switchLabel')} switchHref="/login" switchText={t('auth.signup.switchText')}>
      <div className="grid gap-6">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-soft text-forest">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <path d="m4 7.5 8 5.5 8-5.5" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-subtle uppercase">{t('auth.verify.sentTo')}</p>
            <p dir="ltr" className="truncate text-[15px] font-semibold text-start">{email}</p>
          </div>
        </div>

        <div className="grid gap-3">
          <p className="text-sm leading-relaxed text-muted">{t('auth.verify.missing')}</p>
          <ResendConfirmation />
        </div>

        <p className="grid gap-1.5 text-center text-sm text-muted">
          <Link href="/signup" className="font-semibold text-ink underline underline-offset-4">{t('auth.verify.other')}</Link>
          <span>{t('auth.verify.already')} <Link href="/login" className="font-semibold text-ink underline underline-offset-4">{t('auth.signup.switchText')}</Link></span>
        </p>
      </div>
    </AuthShell>
  );
}
