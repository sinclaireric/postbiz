'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { resendConfirmation, type FormState } from '@/app/(auth)/actions';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { RESEND_COOLDOWN_SECONDS } from '@/lib/auth-callback';
import { FormMessage } from './fields';

const initial: FormState = {};

function ResendButton({ wait }: { wait: number }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="lg" className="w-full" disabled={pending || wait > 0} aria-busy={pending}>
      {pending ? t('auth.wait') : wait > 0 ? t('auth.verify.resendIn', { seconds: wait }) : t('auth.verify.resend')}
    </Button>
  );
}

/** « Renvoyer l'e-mail », avec le compte à rebours qui suit chaque envoi (Supabase n'en accepte qu'un par minute). */
export function ResendConfirmation() {
  const [state, action] = useActionState(resendConfirmation, initial);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (state.message) setWait(RESEND_COOLDOWN_SECONDS);
  }, [state]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  return (
    <form action={action} className="grid gap-3">
      <ResendButton wait={wait} />
      <FormMessage error={state.error} message={state.message} />
    </form>
  );
}
