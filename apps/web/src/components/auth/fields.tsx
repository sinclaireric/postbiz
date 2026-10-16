'use client';

import { useFormStatus } from 'react-dom';
import { useId, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';

export function Field({ label, hint, ...props }: ComponentProps<'input'> & { label: string; hint?: React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        {hint}
      </div>
      <input
        id={id}
        {...props}
        className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] outline-none transition placeholder:text-subtle focus:border-ink focus:ring-4 focus:ring-lime/40"
      />
    </div>
  );
}

export function PasswordField({ label, hint, ...props }: ComponentProps<'input'> & { label: string; hint?: React.ReactNode }) {
  const t = useT();
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        {hint}
      </div>
      <div className="relative mt-1.5">
        <input
          id={id}
          {...props}
          type={shown ? 'text' : 'password'}
          dir="ltr"
          className="h-11 w-full rounded-xl border border-line bg-surface ps-3.5 pe-16 text-[15px] outline-none transition placeholder:text-subtle focus:border-ink focus:ring-4 focus:ring-lime/40"
        />
        <button type="button" onClick={() => setShown((s) => !s)} className="absolute top-1/2 end-3 -translate-y-1/2 text-sm font-medium text-muted hover:text-ink" aria-pressed={shown}>
          {shown ? t('auth.hide') : t('auth.show')}
        </button>
      </div>
    </div>
  );
}

export function SubmitButton({ children, pending: pendingLabel }: { children: React.ReactNode; pending?: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? t('auth.wait')) : children}
    </Button>
  );
}

export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</p>;
  if (message) return <p role="status" className="rounded-xl bg-ok-soft px-4 py-3 text-sm font-medium text-ok">{message}</p>;
  return null;
}
