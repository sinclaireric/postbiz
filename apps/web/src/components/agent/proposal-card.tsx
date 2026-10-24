'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { saveAgentPostsAction } from '@/app/app/(shell)/agent/actions';
import { ChannelAvatar } from '@/components/calendar/channel-avatar';
import { ClockIcon, ImageIcon, TrashIcon } from '@/components/calendar/composer-icons';
import { NetworkPost, type PreviewMedia } from '@/components/calendar/network-post';
import { PostPreview } from '@/components/calendar/post-preview';
import { MediaPicker } from '@/components/media/media-picker';
import { Badge, Button } from '@/components/ui';
import { LOCALE_META } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/client';
import { toAgentMedia } from '@/lib/agent/media';
import type { AgentMedia, AgentMessage, AgentProposal } from '@/lib/agent/types';
import { toLocalInputValue } from '@/lib/calendar/logic';
import type { AgentProposalUpdate, IntegrationItem, MediaItem } from '@/lib/data/types';
import { MAX_MEDIA_PER_POST, MEDIA_RULES } from '@/lib/media/rules';
import { networkName } from '@/lib/networks';
import { FIRST_COMMENT_RULES, NETWORK_RULES, supportsFirstComment, validatePost } from '@/lib/posts/logic';
import { nextSlot } from '@/lib/posts/slots';
import { countLength } from '@/lib/text/length';

/** Ce que l'utilisateur a modifié d'une publication avant de l'enregistrer. `local` : heure locale du navigateur (champ datetime-local). */
interface Edit {
  text: string;
  firstComment: string;
  mediaIds: string[];
  local: string;
}

const toPreview = (m: AgentMedia): PreviewMedia => ({ id: m.id, kind: m.kind, name: m.name, alt: m.alt, url: m.url, thumbUrl: m.thumbUrl, durationSeconds: m.durationSeconds });

/** Le canal de la publication ; s'il n'existe plus, un canal de remplacement pour pouvoir quand même l'afficher. */
const channelOf = (p: AgentProposal, channels: IntegrationItem[]): IntegrationItem =>
  channels.find((c) => c.id === p.integrationId) ?? { id: p.integrationId, networkId: p.networkId, name: p.accountName, username: null, pictureUrl: null, status: 'disabled' };

const field = 'w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/40 disabled:opacity-60';

function SavedCard({ proposal, channel, media }: { proposal: AgentProposal; channel: IntegrationItem; media: Map<string, AgentMedia> }) {
  const t = useT();
  const locale = useLocale();
  const when = proposal.publishAt ? new Intl.DateTimeFormat(LOCALE_META[locale].tag, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(proposal.publishAt)) : '';
  return (
    <article className="rounded-2xl border border-line bg-surface p-3.5">
      <header className="flex items-center gap-2.5">
        <ChannelAvatar channel={channel} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{channel.name}</p>
          <p className="text-xs text-muted">{networkName(channel.networkId)}</p>
        </div>
        <Badge tone={proposal.status === 'scheduled' ? 'lime' : 'ok'}>{proposal.status === 'scheduled' ? t('app.agent.card.scheduled') : t('app.agent.card.drafted')}</Badge>
      </header>
      <p className="mt-3 line-clamp-4 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-muted">{proposal.text}</p>
      {proposal.mediaIds.length > 0 && <p className="mt-1.5 text-xs text-subtle">{proposal.mediaIds.map((id) => media.get(id)?.name).filter(Boolean).join(', ')}</p>}
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span suppressHydrationWarning>{proposal.status === 'scheduled' && when ? t('app.agent.card.scheduledFor', { date: when }) : t('app.agent.card.draftHint')}</span>
        <Link href="/app/calendrier" className="font-semibold text-ink underline underline-offset-4">{t('app.agent.card.openCalendar')}</Link>
      </footer>
    </article>
  );
}

function PendingCard({ proposal, channel, media, edit, onEdit, busy, errors, canWrite, onSave, onPickMedia }: {
  proposal: AgentProposal; channel: IntegrationItem; media: Map<string, AgentMedia>; edit: Edit; onEdit: (patch: Partial<Edit>) => void;
  busy: boolean; errors: string[]; canWrite: boolean; onSave: (mode: 'draft' | 'schedule') => void; onPickMedia: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [commentOpen, setCommentOpen] = useState(Boolean(edit.firstComment));
  const [min, setMin] = useState('');
  useEffect(() => setMin(toLocalInputValue(new Date(Date.now() + 5 * 60_000))), []);

  const attached = edit.mediaIds.flatMap((id) => (media.has(id) ? [media.get(id)!] : []));
  const common = { content: edit.text, networkIds: [proposal.networkId], firstComment: edit.firstComment, media: attached.map((m) => ({ kind: m.kind, name: m.name })) };
  const publishAt = edit.local ? new Date(edit.local).toISOString() : null;
  const issues = { draft: validatePost({ ...common, publishAt, mode: 'draft' }), schedule: edit.local ? validatePost({ ...common, publishAt, mode: 'schedule' }) : [] };
  const usable = channel.status === 'active';
  const messages = [...new Set((edit.local ? issues.schedule : issues.draft).map((e) => t(e.key, e.params)))];
  const text = edit.text.trim();
  const length = countLength(proposal.networkId, text);
  const max = NETWORK_RULES[proposal.networkId].maxLength;
  const disabled = busy || !canWrite || !usable;

  return (
    <article className="rounded-2xl border border-line bg-surface p-3.5">
      <header className="flex flex-wrap items-center gap-2.5">
        <ChannelAvatar channel={channel} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{channel.name}</p>
          <p className="text-xs text-muted">{networkName(channel.networkId)}</p>
        </div>
        <div role="tablist" aria-label={proposal.accountName} className="grid grid-cols-2 gap-0.5 rounded-full bg-wash p-0.5 text-xs font-semibold">
          {(['preview', 'edit'] as const).map((id) => (
            <button
              key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`rounded-full px-3 py-1.5 transition ${tab === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >{id === 'preview' ? t('app.agent.card.preview') : t('app.agent.card.edit')}</button>
          ))}
        </div>
      </header>

      <div className="mt-3">
        {tab === 'preview' ? (
          <div className="mx-auto max-w-[400px]"><PostPreview channels={[channel]} text={edit.text} firstComment={commentOpen ? edit.firstComment : ''} media={attached.map(toPreview)} /></div>
        ) : (
          <div className="grid gap-3">
            <div>
              <label htmlFor={`text-${proposal.id}`} className="text-xs font-semibold text-muted">{t('app.agent.card.text')}</label>
              <textarea
                id={`text-${proposal.id}`} value={edit.text} disabled={disabled} rows={Math.min(14, Math.max(4, edit.text.split('\n').length + 1))}
                onChange={(e) => onEdit({ text: e.target.value })} className={`mt-1 ${field}`}
              />
              <p className={`mt-1 text-xs ${length > max ? 'font-semibold text-danger' : 'text-subtle'}`}>{t('app.composer.charsLimit', { count: length.toLocaleString(), max: max.toLocaleString() })}</p>
            </div>
            {supportsFirstComment(proposal.networkId) && (
              commentOpen ? (
                <div>
                  <label htmlFor={`comment-${proposal.id}`} className="text-xs font-semibold text-muted">{t('app.composer.firstComment')}</label>
                  <textarea
                    id={`comment-${proposal.id}`} value={edit.firstComment} disabled={disabled} rows={2} placeholder={t('app.composer.firstCommentPlaceholder')}
                    onChange={(e) => onEdit({ firstComment: e.target.value })} className={`mt-1 ${field}`}
                  />
                  <p className="mt-1 text-xs text-subtle">{t('app.composer.charsLimit', { count: countLength(proposal.networkId, edit.firstComment.trim()).toLocaleString(), max: FIRST_COMMENT_RULES[proposal.networkId]!.maxLength.toLocaleString() })}</p>
                </div>
              ) : (
                <button type="button" disabled={disabled} onClick={() => setCommentOpen(true)} className="justify-self-start text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50">{t('app.composer.addFirstComment')}</button>
              )
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={disabled || edit.mediaIds.length >= MEDIA_RULES[proposal.networkId].maxItems} onClick={onPickMedia} className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-ink hover:text-ink disabled:pointer-events-none disabled:opacity-50">
                <ImageIcon width={14} height={14} />{t('app.composer.addMediaShort')}
              </button>
            </div>
            {attached.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={t('app.composer.media')}>
                {attached.map((m) => (
                  <li key={m.id} className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-1 ps-1 pe-2 text-xs">
                    {m.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire du stockage
                      <img src={m.thumbUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : <span className="h-6 w-6 rounded-full bg-wash" />}
                    <span className="max-w-32 truncate">{m.name}</span>
                    <button type="button" disabled={disabled} aria-label={t('app.composer.removeMedia', { name: m.name })} onClick={() => onEdit({ mediaIds: edit.mediaIds.filter((x) => x !== m.id) })} className="text-muted hover:text-danger disabled:opacity-50"><TrashIcon width={13} height={13} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {(messages.length > 0 || errors.length > 0) && (
        <ul role="alert" className="mt-3 grid gap-1 rounded-xl bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-danger">
          {[...errors, ...messages].map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {!usable && <p className="mt-3 text-xs font-medium text-warn">{t('app.agent.card.channelGone')}</p>}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
        <label className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold">
          <ClockIcon width={15} height={15} className="text-muted" />
          <span className="sr-only">{t('app.agent.card.date')}</span>
          <input
            type="datetime-local" value={edit.local} min={min} disabled={disabled} onChange={(e) => onEdit({ local: e.target.value })}
            className="bg-transparent outline-none disabled:opacity-60"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={disabled || !text || issues.draft.length > 0} onClick={() => onSave('draft')}>{t('app.agent.card.saveDraft')}</Button>
          <Button type="button" size="sm" disabled={disabled || !text || !edit.local || issues.schedule.length > 0} onClick={() => onSave('schedule')}>{t('app.agent.card.schedule')}</Button>
        </div>
      </footer>
    </article>
  );
}

/**
 * Les publications qu'un message de l'agent propose : une carte par canal, avec aperçu et modification, à enregistrer en brouillon ou à programmer
 * une par une, ou toutes d'un coup. Rien n'est écrit dans le calendrier avant un clic ; l'écriture repasse par les règles du composeur, côté serveur.
 */
export function ProposalSet({ threadId, message, channels, media, canWrite, onSaved, onMedia, picker }: {
  threadId: string; message: AgentMessage; channels: IntegrationItem[]; media: Map<string, AgentMedia>; canWrite: boolean;
  onSaved: (messageId: string, updates: AgentProposalUpdate[]) => void;
  /** Des médias de la bibliothèque viennent d'être joints à une carte : la conversation doit les connaître pour les afficher. */
  onMedia: (items: AgentMedia[]) => void;
  picker: { orgId: string; userId: string; demo: boolean };
}) {
  const t = useT();
  const [edits, setEdits] = useState<Record<string, Edit>>(() => Object.fromEntries(message.proposals.map((p) => [p.id, { text: p.text, firstComment: p.firstComment ?? '', mediaIds: p.mediaIds, local: '' }])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [general, setGeneral] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // La date locale dépend du fuseau du navigateur : elle se pose après l'affichage, pour que le serveur et le navigateur produisent le même premier rendu.
  useEffect(() => {
    const slot = toLocalInputValue(nextSlot(new Date()));
    setEdits((cur) => Object.fromEntries(Object.entries(cur).map(([id, e]) => {
      const p = message.proposals.find((x) => x.id === id);
      return [id, e.local ? e : { ...e, local: p?.publishAt ? toLocalInputValue(new Date(p.publishAt)) : slot }];
    })));
  }, [message.proposals]);

  const pending = message.proposals.filter((p) => p.status === 'pending');

  const save = async (mode: 'draft' | 'schedule', ids: string[]) => {
    setBusy(true);
    setErrors({});
    setGeneral('');
    const items = ids.map((id) => {
      const p = message.proposals.find((x) => x.id === id)!;
      const e = edits[id]!;
      return { id, integrationId: p.integrationId, text: e.text, firstComment: e.firstComment.trim() || null, mediaIds: e.mediaIds, publishAt: e.local ? new Date(e.local).toISOString() : null };
    });
    let result: Awaited<ReturnType<typeof saveAgentPostsAction>>;
    try {
      result = await saveAgentPostsAction({ threadId, messageId: message.id, mode, items });
    } catch {
      result = { error: t('app.agent.errors.failed'), results: [] };
    }
    setBusy(false);
    if (result.error) setGeneral(result.error);
    setErrors(Object.fromEntries(result.results.filter((r) => !r.ok).map((r) => [r.id, r.errors])));
    const saved = items.filter((i) => result.results.some((r) => r.id === i.id && r.ok));
    if (saved.length > 0) onSaved(message.id, saved.map((i) => ({ id: i.id, status: mode === 'draft' ? 'draft' : 'scheduled', text: i.text.trim(), firstComment: i.firstComment, mediaIds: i.mediaIds, publishAt: i.publishAt })));
  };

  // « Tout » n'est proposé que si chaque carte en attente est valide, comme le bouton d'une carte.
  const allValid = pending.every((p) => {
    const e = edits[p.id];
    return e && e.text.trim() && validatePost({ content: e.text, networkIds: [p.networkId], publishAt: e.local ? new Date(e.local).toISOString() : null, mode: 'schedule', firstComment: e.firstComment, media: e.mediaIds.flatMap((id) => (media.has(id) ? [{ kind: media.get(id)!.kind, name: media.get(id)!.name }] : [])) }).length === 0 && channelOf(p, channels).status === 'active';
  });

  return (
    <div className="mt-3 grid gap-3">
      {message.proposals.map((p) => {
        const channel = channelOf(p, channels);
        return p.status === 'pending' && edits[p.id] ? (
          <PendingCard
            key={p.id} proposal={p} channel={channel} media={media} edit={edits[p.id]!} busy={busy} errors={errors[p.id] ?? []} canWrite={canWrite}
            onEdit={(patch) => setEdits((cur) => ({ ...cur, [p.id]: { ...cur[p.id]!, ...patch } }))} onSave={(mode) => save(mode, [p.id])} onPickMedia={() => setPickerFor(p.id)}
          />
        ) : (
          <SavedCard key={p.id} proposal={p} channel={channel} media={media} />
        );
      })}
      {general && <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-danger">{general}</p>}
      {pending.length > 1 && canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => save('draft', pending.map((p) => p.id))}>{t('app.agent.card.saveAllDraft', { count: pending.length })}</Button>
          <Button type="button" size="sm" disabled={busy || !allValid} onClick={() => save('schedule', pending.map((p) => p.id))}>{t('app.agent.card.scheduleAll', { count: pending.length })}</Button>
        </div>
      )}
      {pickerFor && edits[pickerFor] && (
        <MediaPicker
          onClose={() => setPickerFor(null)} orgId={picker.orgId} userId={picker.userId} canWrite={canWrite} demo={picker.demo}
          slots={Math.min(MAX_MEDIA_PER_POST, MEDIA_RULES[message.proposals.find((p) => p.id === pickerFor)!.networkId].maxItems) - edits[pickerFor]!.mediaIds.length}
          excludeIds={edits[pickerFor]!.mediaIds}
          onConfirm={(items: MediaItem[]) => {
            onMedia(items.map(toAgentMedia));
            setEdits((cur) => ({ ...cur, [pickerFor]: { ...cur[pickerFor]!, mediaIds: [...cur[pickerFor]!.mediaIds, ...items.map((m) => m.id).filter((id) => !cur[pickerFor]!.mediaIds.includes(id))] } }));
          }}
        />
      )}
    </div>
  );
}
