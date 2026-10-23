'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createPostAction, type PostFormState } from '@/app/app/(shell)/calendrier/actions';
import { MediaPicker } from '@/components/media/media-picker';
import { SocialIcon } from '@/components/social-icon';
import { Button } from '@/components/ui';
import { LOCALE_META } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/client';
import { toLocalInputValue } from '@/lib/calendar/logic';
import type { IntegrationItem, KnowledgeItem, MediaItem } from '@/lib/data/types';
import { MEDIA_RULES, validateMedia } from '@/lib/media/rules';
import { appendText } from '@/lib/posts/edit';
import { FIRST_COMMENT_RULES, NETWORK_RULES, supportsFirstComment } from '@/lib/posts/logic';
import { inOneHour, nextSlot, tomorrowMorning } from '@/lib/posts/slots';
import { networkName } from '@/lib/networks';
import { countLength } from '@/lib/text/length';
import { plainText } from '@/lib/text/style';
import type { NetworkId } from '@/lib/inbox/types';
import { AiPanel, type AiTab, type ApplyMode } from './ai-panel';
import { ChannelAvatar } from './channel-avatar';
import { ChevronDownIcon, ClockIcon, ImageIcon, PlusIcon, SparklesIcon, TrashIcon } from './composer-icons';
import { MediaStrip } from './media-strip';
import { PostEditor } from './post-editor';
import { PostPreview } from './post-preview';
import { useDismiss } from './use-dismiss';

function Submit({ value, children, variant }: { value: 'draft' | 'schedule'; children: React.ReactNode; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" name="mode" value={value} variant={variant} size="md" disabled={pending}>{children}</Button>;
}

const chip = 'rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold transition hover:border-ink';

/** Choix de la date de publication : créneaux rapides (prochain créneau, dans 1 heure, demain matin) ou date et heure au choix. */
function SchedulePicker({ value, min, onChange, disabled }: { value: string; min: string; onChange: (v: string) => void; disabled: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const label = value
    ? new Intl.DateTimeFormat(LOCALE_META[locale].tag, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
    : t('app.composer.nextSlot');
  const pick = (d: Date) => { onChange(toLocalInputValue(d)); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button
        type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[14px] font-semibold transition hover:border-ink disabled:opacity-50"
      >
        <ClockIcon width={16} height={16} className="text-muted" />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDownIcon width={14} height={14} className="text-muted" />
      </button>
      {open && (
        <div role="dialog" aria-label={t('app.composer.date')} className="absolute start-0 bottom-full z-10 mb-2 grid w-72 gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.3)]">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip} onClick={() => pick(nextSlot(new Date()))}>{t('app.composer.nextSlot')}</button>
            <button type="button" className={chip} onClick={() => pick(inOneHour(new Date()))}>{t('app.composer.inOneHour')}</button>
            <button type="button" className={chip} onClick={() => pick(tomorrowMorning(new Date()))}>{t('app.composer.tomorrowMorning')}</button>
          </div>
          <div>
            <label htmlFor="post-date" className="text-xs font-semibold text-muted">{t('app.composer.pickDate')}</label>
            <input
              id="post-date" type="datetime-local" value={value} min={min} onChange={(e) => onChange(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Un compteur par réseau : le texte est compté comme le réseau le compte, et passe au rouge au-delà de sa limite. */
function CounterChips({ networks, text, limit }: { networks: NetworkId[]; text: string; limit: (id: NetworkId) => number }) {
  const t = useT();
  const trimmed = text.trim();
  if (networks.length === 0) return <span className="px-2 text-subtle">{t('app.composer.chars', { count: [...trimmed].length })}</span>;
  return (
    <>
      {networks.map((n) => {
        const length = countLength(n, trimmed);
        const max = limit(n);
        return (
          <span key={n} title={networkName(n)} className={`flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${length > max ? 'bg-danger-soft text-danger' : 'bg-wash text-muted'}`}>
            <SocialIcon id={n} size={14} />{length.toLocaleString()} / {max.toLocaleString()}
          </span>
        );
      })}
    </>
  );
}

type Side = 'preview' | 'ai';

export function Composer({
  integrations, knowledge, aiEnabled, canWrite, orgId, userId, demo, initialLocal = '', initialChannel = null, onSaved, onClose,
}: {
  integrations: IntegrationItem[]; knowledge: KnowledgeItem[]; aiEnabled: boolean; canWrite: boolean; orgId: string; userId: string; demo: boolean;
  initialLocal?: string; /** Canal affiché dans le calendrier : il est coché d'office. */ initialChannel?: string | null; onSaved?: () => void; onClose: () => void;
}) {
  const t = useT();
  const [state, action] = useActionState<PostFormState, FormData>(createPostAction, {});
  const [selected, setSelected] = useState<string[]>(() => (initialChannel && integrations.some((i) => i.id === initialChannel && i.status === 'active') ? [initialChannel] : []));
  const [content, setContent] = useState('');
  const [local, setLocal] = useState(initialLocal);
  const [min, setMin] = useState('');
  const [side, setSide] = useState<Side>('preview');
  const [aiTab, setAiTab] = useState<AiTab>('write');
  const [createAnother, setCreateAnother] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [firstComment, setFirstComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const now = new Date();
    setMin(toLocalInputValue(new Date(now.getTime() + 5 * 60_000)));
    setLocal((current) => current || toLocalInputValue(nextSlot(now)));
  }, []);

  useEffect(() => {
    if (!state.savedAt) return;
    setContent('');
    setFirstComment('');
    setCommentOpen(false);
    setMedia([]);
    setUndo(null);
    if (createAnother) setLocal(toLocalInputValue(nextSlot(new Date())));
    else onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt]);

  const chosen = integrations.filter((i) => selected.includes(i.id));
  const networks = [...new Set(chosen.map((i) => i.networkId))];
  const commentNetworks = networks.filter(supportsFirstComment);
  const skippedForComment = networks.filter((n) => !supportsFirstComment(n));
  // Fuseau du navigateur converti en UTC avant l'envoi : le serveur ne connaît pas le fuseau de l'utilisateur.
  const publishAtIso = local ? new Date(local).toISOString() : '';
  // Médias : chaque réseau a ses limites ; on joint au plus ce que le plus strict des canaux choisis accepte.
  const maxMedia = networks.length > 0 ? Math.min(...networks.map((n) => MEDIA_RULES[n].maxItems)) : MEDIA_RULES.instagram.maxItems;
  const mediaMessages = [...new Set(networks.flatMap((n) => validateMedia(n, media)).map((e) => t(e.key, e.params)))];

  const apply = (text: string, mode: ApplyMode) => {
    setUndo(content);
    setContent(mode === 'replace' ? text : appendText(content, text));
  };

  const header = (
    <header className="flex items-start justify-between gap-4">
      <h2 className="text-lg font-semibold">{t('app.composer.title')}</h2>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button" onClick={() => setSide((s) => (s === 'ai' ? 'preview' : 'ai'))} aria-pressed={side === 'ai'}
          className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition ${side === 'ai' ? 'bg-lime text-ink' : 'border border-line bg-surface hover:border-ink'}`}
        >
          <SparklesIcon width={16} height={16} />{t('app.ai.title')}
        </button>
        <button type="button" onClick={onClose} aria-label={t('app.modal.close')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-wash hover:text-ink">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
    </header>
  );

  if (integrations.length === 0) {
    return (
      <div>
        {header}
        <div className="mt-5 rounded-3xl border border-dashed border-line bg-paper p-8 text-center">
          <p className="font-semibold">{t('app.composer.noChannelsTitle')}</p>
          <p className="mt-1 text-sm text-muted">{t('app.composer.noChannelsText')}</p>
          <Link href="/app/canaux" className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white hover:bg-black/80">{t('app.composer.addChannel')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form action={action} className="min-w-0">
          <fieldset>
            <legend className="sr-only">{t('app.composer.channels')}</legend>
            <div className="flex flex-wrap items-center gap-3">
              {integrations.map((i) => {
                const usable = i.status === 'active';
                const on = selected.includes(i.id);
                const hint = !usable ? `${i.name} ${t('app.composer.toReconnect')}` : NETWORK_RULES[i.networkId].requiresMedia ? `${i.name} ${t('app.composer.mediaRequired')}` : i.name;
                return (
                  <label key={i.id} title={hint} className={`relative rounded-full p-0.5 transition ${on ? 'ring-2 ring-ink ring-offset-2' : 'hover:ring-2 hover:ring-ink/20 hover:ring-offset-2'} ${usable && canWrite ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}>
                    <input
                      type="checkbox" name="integrationId" value={i.id} className="sr-only" disabled={!usable || !canWrite} checked={on}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))}
                    />
                    <ChannelAvatar channel={i} />
                    <span className="sr-only">{hint}</span>
                  </label>
                );
              })}
              <Link href="/app/canaux" aria-label={t('app.composer.addChannel')} title={t('app.composer.addChannel')} className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-line text-muted transition hover:border-ink hover:text-ink">
                <PlusIcon width={18} height={18} />
              </Link>
            </div>
          </fieldset>

          <PostEditor
            id="post-content" name="content" label={t('app.composer.text')} value={content} disabled={!canWrite} placeholder={t('app.composer.placeholder')}
            className="mt-5" rows={9} onMedia={() => setPickerOpen(true)}
            onValueChange={(value) => { setContent(value); setUndo(null); }}
            tools={
              <button type="button" disabled={!canWrite} onClick={() => { setAiTab('improve'); setSide('ai'); }} className="ms-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-forest transition hover:bg-lime-soft disabled:opacity-50">
                <SparklesIcon width={15} height={15} />{t('app.ai.improveShort')}
              </button>
            }
            footer={<CounterChips networks={networks} text={content} limit={(n) => NETWORK_RULES[n].maxLength} />}
          />

          {undo !== null && (
            <p role="status" className="mt-2 flex items-center gap-2 text-sm text-muted">
              {t('app.composer.aiApplied')}
              <button type="button" onClick={() => { setContent(undo); setUndo(null); }} className="font-semibold text-ink underline underline-offset-4">{t('app.composer.undo')}</button>
            </p>
          )}

          {media.length === 0 ? (
            <button
              type="button" disabled={!canWrite} onClick={() => setPickerOpen(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm font-semibold text-muted transition hover:border-ink hover:text-ink disabled:pointer-events-none disabled:opacity-50"
            ><ImageIcon width={18} height={18} className="shrink-0" />{t('app.composer.addMedia')}</button>
          ) : (
            <MediaStrip items={media} onChange={setMedia} onAdd={() => setPickerOpen(true)} disabled={!canWrite} max={maxMedia} />
          )}
          {mediaMessages.length > 0 && (
            <ul role="status" className="mt-2 grid gap-1 text-xs font-medium text-warn">{mediaMessages.map((m) => <li key={m}>{m}</li>)}</ul>
          )}
          <input type="hidden" name="media" value={JSON.stringify(media.map((m) => ({ id: m.id, alt: m.alt })))} />

          {commentOpen ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="first-comment" className="text-sm font-semibold">{t('app.composer.firstComment')}</label>
                <button
                  type="button" disabled={!canWrite} onClick={() => { setCommentOpen(false); setFirstComment(''); }}
                  aria-label={t('app.composer.removeFirstComment')} title={t('app.composer.removeFirstComment')}
                  className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                ><TrashIcon width={16} height={16} /></button>
              </div>
              <PostEditor
                id="first-comment" name="firstComment" label={t('app.composer.firstComment')} value={firstComment} disabled={!canWrite}
                placeholder={t('app.composer.firstCommentPlaceholder')} rows={3} onValueChange={setFirstComment}
                footer={commentNetworks.length > 0 ? <CounterChips networks={commentNetworks} text={firstComment} limit={(n) => FIRST_COMMENT_RULES[n]!.maxLength} /> : undefined}
              />
              <p className="mt-1.5 text-xs text-subtle">{t('app.composer.firstCommentHint')}</p>
              {networks.length > 0 && commentNetworks.length === 0 && <p role="status" className="mt-1 text-xs font-medium text-warn">{t('app.validation.firstCommentUnsupported')}</p>}
              {commentNetworks.length > 0 && skippedForComment.length > 0 && firstComment.trim() && (
                <p role="status" className="mt-1 text-xs font-medium text-warn">{t('app.composer.firstCommentSkipped', { networks: skippedForComment.map(networkName).join(', ') })}</p>
              )}
            </div>
          ) : (
            <button
              type="button" disabled={!canWrite} onClick={() => setCommentOpen(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-2.5 text-sm font-semibold text-muted transition hover:border-ink hover:text-ink disabled:pointer-events-none disabled:opacity-50"
            ><PlusIcon width={16} height={16} />{t('app.composer.addFirstComment')}</button>
          )}


          <input type="hidden" name="publishAt" value={publishAtIso} />

          {state.errors && state.errors.length > 0 && (
            <ul role="alert" className="mt-4 grid gap-1 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {state.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {state.savedAt && !state.errors && <p role="status" className="mt-4 rounded-xl bg-ok-soft px-4 py-3 text-sm font-medium text-ok">{t('app.composer.saved')}</p>}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={createAnother} onChange={(e) => setCreateAnother(e.target.checked)} className="size-4 accent-ink" />
                {t('app.composer.createAnother')}
              </label>
              <Submit value="draft" variant="secondary">{t('app.composer.draft')}</Submit>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SchedulePicker value={local} min={min} onChange={setLocal} disabled={!canWrite} />
              <Submit value="schedule" variant="primary">{t('app.composer.schedule')}</Submit>
            </div>
          </div>
          {!canWrite && <p className="mt-3 text-sm text-muted">{t('app.composer.viewerNote')}</p>}
        </form>

        <aside className="min-w-0 border-t border-line pt-6 lg:max-h-[calc(92dvh-8rem)] lg:overflow-y-auto lg:border-t-0 lg:border-s lg:ps-6 lg:pt-0">
          <div role="tablist" aria-label={t('app.composer.sidePanel')} className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-wash p-1">
            {(['preview', 'ai'] as const).map((id) => (
              <button
                key={id} type="button" role="tab" aria-selected={side === id} onClick={() => setSide(id)}
                className={`flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${side === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {id === 'ai' && <SparklesIcon width={15} height={15} />}
                {id === 'preview' ? t('app.composer.preview') : t('app.ai.title')}
              </button>
            ))}
          </div>
          {side === 'preview' ? (
            <PostPreview channels={chosen} text={content} firstComment={commentOpen ? firstComment : ''} media={media} />
          ) : (
            <AiPanel enabled={aiEnabled} canWrite={canWrite} content={plainText(content)} networkIds={networks} knowledge={knowledge} tab={aiTab} onTabChange={setAiTab} onApply={apply} />
          )}
        </aside>
      </div>
      {pickerOpen && (
        <MediaPicker
          onClose={() => setPickerOpen(false)} orgId={orgId} userId={userId} canWrite={canWrite} demo={demo}
          slots={maxMedia - media.length} excludeIds={media.map((m) => m.id)}
          onConfirm={(items) => setMedia((cur) => [...cur, ...items.filter((m) => !cur.some((c) => c.id === m.id))].slice(0, maxMedia))}
        />
      )}
    </div>
  );
}
