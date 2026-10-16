'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { NetworkDot } from '@/components/app/network-dot';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { IntegrationItem } from '@/lib/data/types';
import { NETWORK_RULES, tightestLimit } from '@/lib/posts/logic';
import { createPostAction, type PostFormState } from '@/app/app/(shell)/calendrier/actions';

function Submit({ value, children, variant }: { value: 'draft' | 'schedule'; children: React.ReactNode; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" name="mode" value={value} variant={variant} size="md" disabled={pending}>{children}</Button>;
}

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Composer({
  integrations, canWrite, initialLocal = '', onSaved, embedded = false,
}: { integrations: IntegrationItem[]; canWrite: boolean; initialLocal?: string; onSaved?: () => void; embedded?: boolean }) {
  const t = useT();
  const [state, action] = useActionState<PostFormState, FormData>(createPostAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [local, setLocal] = useState(initialLocal);
  const [min, setMin] = useState('');

  useEffect(() => setMin(toLocalInput(new Date(Date.now() + 5 * 60_000))), []);
  useEffect(() => {
    if (state.savedAt) {
      ref.current?.reset();
      setSelected([]);
      setContent('');
      setLocal('');
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt]);

  const chosen = integrations.filter((i) => selected.includes(i.id));
  const limit = tightestLimit(chosen.map((i) => i.networkId));
  const over = limit !== null && content.trim().length > limit;
  // Fuseau du navigateur converti en UTC avant l'envoi : le serveur ne connaît pas le fuseau de l'utilisateur.
  const publishAtIso = local ? new Date(local).toISOString() : '';

  if (integrations.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line bg-surface p-8 text-center">
        <p className="font-semibold">{t('app.composer.noChannelsTitle')}</p>
        <p className="mt-1 text-sm text-muted">{t('app.composer.noChannelsText')}</p>
      </div>
    );
  }

  return (
    <form ref={ref} action={action} className={embedded ? '' : 'rounded-3xl border border-line bg-surface p-6'}>
      {!embedded && <h2 className="text-lg font-semibold">{t('app.composer.title')}</h2>}

      <fieldset className={embedded ? '' : 'mt-4'}>
        <legend className="text-sm font-semibold">{t('app.composer.channels')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {integrations.map((i) => {
            const usable = i.status === 'active';
            const on = selected.includes(i.id);
            return (
              <label key={i.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${on ? 'border-ink bg-ink text-white' : 'border-line bg-paper hover:border-ink/40'} ${usable ? '' : 'cursor-not-allowed opacity-50'}`}>
                <input
                  type="checkbox" name="integrationId" value={i.id} className="sr-only" disabled={!usable || !canWrite} checked={on}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))}
                />
                <NetworkDot id={i.networkId} size={9} />
                {i.name}
                {!usable && <span className="text-xs font-medium">{t('app.composer.toReconnect')}</span>}
                {usable && NETWORK_RULES[i.networkId].requiresMedia && <span className="text-xs font-medium opacity-70">{t('app.composer.mediaRequired')}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5">
        <label htmlFor="post-content" className="text-sm font-semibold">{t('app.composer.text')}</label>
        <textarea
          id="post-content" name="content" rows={5} value={content} onChange={(e) => setContent(e.target.value)} disabled={!canWrite}
          placeholder={t('app.composer.placeholder')}
          className={`mt-2 w-full resize-y rounded-2xl border bg-paper px-4 py-3 text-[15px] outline-none transition focus:ring-4 ${over ? 'border-danger focus:ring-danger/20' : 'border-line focus:border-ink focus:ring-lime/40'}`}
        />
        <p className={`mt-1 text-end text-xs ${over ? 'font-semibold text-danger' : 'text-subtle'}`}>
          {limit ? t('app.composer.charsLimit', { count: content.trim().length, max: limit }) : t('app.composer.chars', { count: content.trim().length })}
        </p>
      </div>

      <div className="mt-3">
        <label htmlFor="post-date" className="text-sm font-semibold">{t('app.composer.date')}</label>
        <input
          id="post-date" type="datetime-local" value={local} min={min} onChange={(e) => setLocal(e.target.value)} disabled={!canWrite}
          className="mt-2 h-11 w-full max-w-xs rounded-xl border border-line bg-paper px-3.5 text-[15px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
        />
        <input type="hidden" name="publishAt" value={publishAtIso} />
      </div>

      {state.errors && state.errors.length > 0 && (
        <ul role="alert" className="mt-4 grid gap-1 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {state.savedAt && !state.errors && <p role="status" className="mt-4 rounded-xl bg-ok-soft px-4 py-3 text-sm font-medium text-ok">{t('app.composer.saved')}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        <Submit value="schedule" variant="primary">{t('app.composer.schedule')}</Submit>
        <Submit value="draft" variant="secondary">{t('app.composer.draft')}</Submit>
      </div>
      {!canWrite && <p className="mt-3 text-sm text-muted">{t('app.composer.viewerNote')}</p>}
    </form>
  );
}
