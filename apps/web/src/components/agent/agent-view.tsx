'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteThreadAction, loadThreadAction } from '@/app/app/(shell)/agent/actions';
import { ChannelAvatar } from '@/components/calendar/channel-avatar';
import { ImageIcon, PlusIcon, SparklesIcon, TrashIcon } from '@/components/calendar/composer-icons';
import { MediaPicker } from '@/components/media/media-picker';
import { MediaThumb } from '@/components/media/media-thumb';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';
import { streamChat } from '@/lib/agent/client';
import { toAgentMedia } from '@/lib/agent/media';
import type { LoadedThread } from '@/lib/agent/load';
import { AGENT_LIMITS, type AgentErrorCode, type AgentMedia, type AgentMessage, type AgentThread, type AgentToolName, type VideoJobResponse } from '@/lib/agent/types';
import type { AgentProposalUpdate, IntegrationItem } from '@/lib/data/types';
import { networkName } from '@/lib/networks';
import { NETWORK_RULES } from '@/lib/posts/logic';
import { GeneratedImages } from './generated-images';
import { ProposalSet } from './proposal-card';
import { VideoJobCard, type VideoJobState } from './video-job-card';

const ERROR_KEY: Record<AgentErrorCode, MessageKey> = {
  disabled: 'app.agent.errors.disabled', forbidden: 'app.agent.errors.forbidden', invalid: 'app.agent.errors.invalid', rate_limited: 'app.agent.errors.rate_limited',
  refused: 'app.agent.errors.refused', empty: 'app.agent.errors.empty', failed: 'app.agent.errors.failed', not_found: 'app.agent.errors.notFound',
};
const TOOL_KEY: Record<AgentToolName, MessageKey> = {
  list_posts: 'app.agent.tool.list_posts', list_media: 'app.agent.tool.list_media', propose_posts: 'app.agent.tool.propose_posts',
  generate_image: 'app.agent.tool.generate_image', generate_video: 'app.agent.tool.generate_video', video_status: 'app.agent.tool.video_status',
};
const SUGGESTIONS: MessageKey[] = ['app.agent.suggestions.one', 'app.agent.suggestions.two', 'app.agent.suggestions.three', 'app.agent.suggestions.four'];

const index = (items: AgentMedia[]) => new Map(items.map((m) => [m.id, m]));
const jobStates = (jobs: LoadedThread['jobs'], media: AgentMedia[]) => new Map(jobs.map((job): [string, VideoJobState] => [job.id, { job, media: media.find((m) => m.id === job.mediaId) ?? null, url: null }]));
const storageKey = (orgId: string) => `postbiz.agent.channels.${orgId}`;

/** Un canal que l'agent peut utiliser : actif, et sur un réseau que l'application sait traiter. */
const usable = (c: IntegrationItem) => c.status === 'active' && c.networkId in NETWORK_RULES;

function ChannelRow({ channel, on, onToggle, disabled }: { channel: IntegrationItem; on: boolean; onToggle: () => void; disabled: boolean }) {
  const t = useT();
  const ok = usable(channel);
  return (
    <label className={`flex items-center gap-3 rounded-xl px-2.5 py-2 transition ${ok && !disabled ? 'cursor-pointer hover:bg-wash' : 'cursor-not-allowed opacity-50'} ${on ? 'bg-wash ring-1 ring-ink/15' : ''}`}>
      <input type="checkbox" className="sr-only" checked={on && ok} disabled={!ok || disabled} onChange={onToggle} />
      <ChannelAvatar channel={channel} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{channel.name}</span>
        <span className="block truncate text-xs text-muted">{ok ? networkName(channel.networkId) : t('app.agent.channels.reconnect')}</span>
      </span>
      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${on && ok ? 'border-ink bg-ink text-white' : 'border-line text-transparent'}`}>✓</span>
    </label>
  );
}

function UserBubble({ message, media }: { message: AgentMessage; media: Map<string, AgentMedia> }) {
  const attached = message.mediaIds.flatMap((id) => (media.has(id) ? [media.get(id)!] : []));
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-3xl rounded-ee-md bg-ink px-4 py-3 text-[14.5px] leading-relaxed text-white">
        {attached.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {attached.map((m) => <li key={m.id} className="h-14 w-14 overflow-hidden rounded-xl"><MediaThumb item={m} showDuration={false} /></li>)}
          </ul>
        )}
        {message.text && <p className="break-words whitespace-pre-wrap">{message.text}</p>}
      </div>
    </div>
  );
}

function AgentAvatar() {
  return <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lime text-ink" aria-hidden="true"><SparklesIcon width={16} height={16} /></span>;
}

export function AgentView({ integrations, threads: initialThreads, initial, canWrite, aiEnabled, demo, orgId, userId }: {
  integrations: IntegrationItem[]; threads: AgentThread[]; initial: LoadedThread | null; canWrite: boolean; aiEnabled: boolean; demo: boolean; orgId: string; userId: string;
}) {
  const t = useT();
  const [threads, setThreads] = useState(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(initial?.thread.id ?? null);
  const [messages, setMessages] = useState<AgentMessage[]>(initial?.messages ?? []);
  const [media, setMedia] = useState<Map<string, AgentMedia>>(() => index(initial?.media ?? []));
  const [selected, setSelected] = useState<string[]>(() => integrations.filter(usable).map((c) => c.id));
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<AgentMedia[]>([]);
  const [jobs, setJobs] = useState<Map<string, VideoJobState>>(() => jobStates(initial?.jobs ?? [], initial?.media ?? []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<AgentMessage | null>(null);
  const [run, setRun] = useState<{ text: string; tool: AgentToolName | null; images: AgentMedia[]; jobs: string[] } | null>(null);
  const [error, setError] = useState<AgentErrorCode | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  // Les canaux cochés se retrouvent d'une visite à l'autre (navigateur seulement : c'est un confort, pas une donnée).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(orgId)) ?? 'null') as unknown;
      if (Array.isArray(saved)) setSelected(integrations.filter((c) => usable(c) && saved.includes(c.id)).map((c) => c.id));
    } catch {
      // stockage indisponible : tous les canaux restent cochés
    }
  }, [orgId, integrations]);

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, AGENT_LIMITS.channels);
      try {
        localStorage.setItem(storageKey(orgId), JSON.stringify(next));
      } catch {
        // ignoré
      }
      return next;
    });
  };

  const busy = run !== null;
  const ready = canWrite && aiEnabled;
  const channels = useMemo(() => integrations.filter((c) => selected.includes(c.id) && usable(c)), [integrations, selected]);

  // La conversation reste calée sur son dernier message ; l'écran d'accueil, lui, reste en haut.
  useEffect(() => {
    const el = scroller.current;
    if (el && (messages.length > 0 || run || pendingUser)) el.scrollTop = el.scrollHeight;
  }, [messages, run, pendingUser]);

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setActiveId(null);
    setMessages([]);
    setMedia(new Map());
    setJobs(new Map());
    setRun(null);
    setPendingUser(null);
    setError(null);
    setHistoryOpen(false);
    window.history.replaceState(null, '', '/app/agent');
  }, []);

  const open = async (id: string) => {
    if (id === activeId) return setHistoryOpen(false);
    abort.current?.abort();
    setRun(null);
    setPendingUser(null);
    setError(null);
    const loaded = await loadThreadAction(id);
    if (!loaded) return setError('not_found');
    setActiveId(loaded.thread.id);
    setMessages(loaded.messages);
    setMedia(index(loaded.media));
    setJobs(jobStates(loaded.jobs, loaded.media));
    setHistoryOpen(false);
    window.history.replaceState(null, '', `/app/agent?c=${loaded.thread.id}`);
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    if (!(await deleteThreadAction(id))) return setError('failed');
    setThreads((cur) => cur.filter((x) => x.id !== id));
    if (id === activeId) reset();
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (busy || !ready || (!text && attached.length === 0)) return;
    const sent = attached;
    setError(null);
    setDraft('');
    setAttached([]);
    addMedia(sent);
    setPendingUser({ id: 'pending', role: 'user', text, proposals: [], mediaIds: sent.map((m) => m.id), jobIds: [], createdAt: new Date().toISOString() });
    setRun({ text: '', tool: null, images: [], jobs: [] });
    const controller = new AbortController();
    abort.current = controller;
    let failed: AgentErrorCode | null = null;

    await streamChat(
      { threadId: activeId, message: text, channelIds: channels.map((c) => c.id), mediaIds: sent.map((m) => m.id), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      (event) => {
        if (event.type === 'text') setRun((r) => (r ? { ...r, text: r.text + event.delta, tool: null } : r));
        else if (event.type === 'tool') setRun((r) => (r ? { ...r, tool: event.name } : r));
        else if (event.type === 'proposals') addMedia(event.media);
        else if (event.type === 'media') {
          addMedia(event.media);
          setRun((r) => (r ? { ...r, images: [...r.images, ...event.media.filter((m) => !r.images.some((x) => x.id === m.id))] } : r));
        } else if (event.type === 'job') {
          setJobs((cur) => new Map(cur).set(event.job.id, { media: null, url: null, ...cur.get(event.job.id), job: event.job }));
          setRun((r) => (r && !r.jobs.includes(event.job.id) ? { ...r, jobs: [...r.jobs, event.job.id] } : r));
        }
        else if (event.type === 'done') {
          setMessages((cur) => [...cur, event.user, event.assistant]);
          setThreads((cur) => [event.thread, ...cur.filter((x) => x.id !== event.thread.id)]);
          setActiveId(event.thread.id);
          // Le message enregistré remplace la réponse en cours d'affichage dans le même rendu : pas de doublon un instant.
          setRun(null);
          setPendingUser(null);
          window.history.replaceState(null, '', `/app/agent?c=${event.thread.id}`);
        } else failed = event.code;
      },
      controller.signal,
    );

    abort.current = null;
    setRun(null);
    setPendingUser(null);
    if (failed || controller.signal.aborted) {
      // Rien n'a été enregistré : le message revient dans le champ, prêt à être renvoyé.
      setDraft(text);
      setAttached(sent);
      if (failed) setError(failed);
    }
  };

  const addMedia = (items: AgentMedia[]) => setMedia((cur) => new Map([...cur, ...items.map((m): [string, AgentMedia] => [m.id, m])]));

  // Une vidéo avance (ou se termine) : son état est gardé ici, et la vidéo terminée rejoint les médias connus de la conversation.
  const onJob = (response: VideoJobResponse) => {
    setJobs((cur) => new Map(cur).set(response.job.id, { job: response.job, media: response.media, url: response.url }));
    if (response.media) addMedia([response.media]);
  };

  // « Préparer une publication avec cette vidéo » : la vidéo rejoint les pièces jointes et le champ propose la demande ; l'utilisateur l'envoie quand il veut.
  const attachVideo = (video: AgentMedia, url: string | null) => {
    setAttached((cur) => (cur.some((m) => m.id === video.id) ? cur : [...cur, { ...video, url: url ?? video.url }].slice(0, AGENT_LIMITS.mediaPerMessage)));
    setDraft((d) => d || t('app.agent.video.usePrompt'));
    input.current?.focus();
  };

  const onSaved = (messageId: string, updates: AgentProposalUpdate[]) =>
    setMessages((cur) => cur.map((m) => (m.id !== messageId ? m : { ...m, proposals: m.proposals.map((p) => { const u = updates.find((x) => x.id === p.id); return u ? { ...p, ...u } : p; }) })));

  const shown = pendingUser ? [...messages, pendingUser] : messages;
  const noChannel = ready && channels.length === 0;

  const channelList = (
    <>
      {integrations.length === 0 ? (
        <div className="px-1 py-4 text-sm text-muted">
          <p>{t('app.agent.channels.none')}</p>
          <Link href="/app/canaux" className="mt-2 inline-block font-semibold text-ink underline underline-offset-4">{t('app.agent.channels.add')}</Link>
        </div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {integrations.map((c) => <li key={c.id}><ChannelRow channel={c} on={selected.includes(c.id)} onToggle={() => toggle(c.id)} disabled={busy} /></li>)}
        </ul>
      )}
    </>
  );

  const historyList = (
    <>
      <button
        type="button" onClick={reset}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-white transition hover:bg-black/80"
      ><PlusIcon width={16} height={16} />{t('app.agent.history.new')}</button>
      {threads.length === 0 ? (
        <p className="mt-4 px-1 text-sm text-muted">{t('app.agent.history.empty')}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-0.5" aria-label={t('app.agent.history.title')}>
          {threads.map((th) => (
            <li key={th.id} className={`group flex items-center gap-1 rounded-xl ${th.id === activeId ? 'bg-wash' : 'hover:bg-wash'}`}>
              <button type="button" onClick={() => open(th.id)} aria-current={th.id === activeId ? 'true' : undefined} className="min-w-0 flex-1 truncate px-3 py-2 text-start text-sm">{th.title}</button>
              {confirmDelete === th.id ? (
                <button type="button" onClick={() => remove(th.id)} className="me-1 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">{t('app.agent.history.confirmDelete')}</button>
              ) : (
                <button
                  type="button" onClick={() => setConfirmDelete(th.id)} onBlur={() => setConfirmDelete((c) => (c === th.id ? null : c))}
                  aria-label={t('app.agent.history.delete', { title: th.title })} title={t('app.agent.history.delete', { title: th.title })}
                  className="me-1 rounded-full p-1.5 text-muted opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-danger-soft hover:text-danger max-lg:opacity-100"
                ><TrashIcon width={14} height={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Canaux : colonne à gauche (bureau) ; bandeau sous le titre (mobile). */}
      <aside className="hidden w-[270px] shrink-0 flex-col gap-3 overflow-y-auto border-e border-line bg-surface p-4 lg:flex" aria-label={t('app.agent.channels.title')}>
        <div>
          <h2 className="text-base font-semibold">{t('app.agent.channels.title')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('app.agent.channels.hint')}</p>
        </div>
        {channelList}
      </aside>

      <section className="flex min-h-[78dvh] min-w-0 flex-1 flex-col bg-paper lg:min-h-0">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2.5 xl:hidden">
          <p className="text-sm font-semibold lg:invisible">{t('app.agent.channels.selected', { count: channels.length })}</p>
          <button type="button" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} className="rounded-full border border-line px-3.5 py-1.5 text-[13px] font-semibold">{t('app.agent.history.title')}</button>
        </div>
        {historyOpen && <div className="border-b border-line bg-surface p-4 xl:hidden">{historyList}</div>}
        <div className="overflow-x-auto border-b border-line bg-surface px-4 py-2 lg:hidden" aria-label={t('app.agent.channels.title')}>
          <ul className="flex gap-2">
            {integrations.map((c) => {
              const on = selected.includes(c.id) && usable(c);
              return (
                <li key={c.id} className="shrink-0">
                  <button type="button" disabled={!usable(c) || busy} aria-pressed={on} onClick={() => toggle(c.id)} className={`flex items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-[13px] font-semibold transition disabled:opacity-40 ${on ? 'border-ink bg-wash' : 'border-line opacity-60'}`}>
                    <ChannelAvatar channel={c} size={26} badge={false} />{c.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" aria-live="polite">
          <div className="mx-auto grid max-w-3xl gap-5">
            {shown.length === 0 && !run ? (
              <div className="py-6 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lime text-ink" aria-hidden="true"><SparklesIcon width={22} height={22} /></span>
                <h2 className="mt-4 text-xl font-semibold tracking-tight">{t('app.agent.welcome.title')}</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">{t('app.agent.welcome.text')}</p>
                {ready && (
                  <ul className="mx-auto mt-6 grid max-w-xl gap-2 text-start" aria-label={t('app.agent.welcome.try')}>
                    {SUGGESTIONS.map((key) => (
                      <li key={key}>
                        <button type="button" onClick={() => { setDraft(t(key)); input.current?.focus(); }} className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] leading-snug transition hover:border-ink">{t(key)}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              shown.map((m) =>
                m.role === 'user' ? (
                  <UserBubble key={m.id} message={m} media={media} />
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <AgentAvatar />
                    <div className="min-w-0 flex-1">
                      <p className="break-words whitespace-pre-wrap text-[14.5px] leading-relaxed">{m.text || (m.proposals.length > 0 ? t('app.agent.proposals.fallback') : '')}</p>
                      <GeneratedImages items={m.mediaIds.flatMap((id) => (media.has(id) ? [media.get(id)!] : []))} />
                      {m.jobIds.map((id) => jobs.has(id) && <VideoJobCard key={id} state={jobs.get(id)!} demo={demo} canWrite={canWrite} onUpdate={onJob} onUse={attachVideo} />)}
                      {m.proposals.length > 0 && activeId && <ProposalSet threadId={activeId} message={m} channels={integrations} media={media} canWrite={canWrite} onSaved={onSaved} onMedia={addMedia} picker={{ orgId, userId, demo }} />}
                    </div>
                  </div>
                ),
              )
            )}
            {run && (
              <div className="flex gap-3">
                <AgentAvatar />
                <div className="min-w-0 flex-1">
                  {run.text && <p className="break-words whitespace-pre-wrap text-[14.5px] leading-relaxed">{run.text}</p>}
                  <GeneratedImages items={run.images} />
                  {run.jobs.map((id) => jobs.has(id) && <VideoJobCard key={id} state={jobs.get(id)!} demo={demo} canWrite={canWrite} onUpdate={onJob} onUse={attachVideo} />)}
                  <p role="status" className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
                    {run.tool ? t(TOOL_KEY[run.tool]) : t('app.agent.thinking')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sur mobile, la page défile avec la conversation : le champ de saisie reste collé au-dessus de la barre d'onglets (68 px). */}
        <div className="z-10 border-t border-line bg-surface px-4 py-3 max-lg:sticky max-lg:bottom-[68px] sm:px-8">
          <div className="mx-auto max-w-3xl">
            {demo && <p className="mb-2 rounded-xl bg-warn-soft px-3 py-1.5 text-center text-xs font-medium text-warn">{t('app.agent.demoNote')}</p>}
            {!canWrite && <p className="mb-2 text-sm text-muted">{t('app.agent.composer.viewer')}</p>}
            {canWrite && !aiEnabled && <p role="status" className="mb-2 rounded-xl bg-wash px-3.5 py-2.5 text-sm text-muted">{t('app.agent.composer.disabled')}</p>}
            {noChannel && <p role="status" className="mb-2 text-sm font-medium text-warn">{t('app.agent.composer.noChannel')}</p>}
            {error && <p role="alert" className="mb-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">{t(ERROR_KEY[error])}</p>}
            {attached.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('app.agent.composer.attached')}>
                {attached.map((m) => (
                  <li key={m.id} className="relative h-14 w-14 overflow-hidden rounded-xl border border-line">
                    <MediaThumb item={m} showDuration={false} />
                    <button type="button" aria-label={t('app.composer.removeMedia', { name: m.name })} onClick={() => setAttached((cur) => cur.filter((x) => x.id !== m.id))} className="absolute end-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/70 text-white hover:bg-ink">
                      <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); void send(draft); }}
              className="flex items-end gap-2 rounded-3xl border border-line bg-paper p-2 focus-within:border-ink focus-within:ring-4 focus-within:ring-lime/40"
            >
              <button
                type="button" disabled={!ready || busy || attached.length >= AGENT_LIMITS.mediaPerMessage} onClick={() => setPickerOpen(true)}
                aria-label={t('app.agent.composer.attach')} title={t('app.agent.composer.attach')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-wash hover:text-ink disabled:opacity-40"
              ><ImageIcon width={19} height={19} /></button>
              <textarea
                ref={input} value={draft} rows={1} disabled={!ready} maxLength={AGENT_LIMITS.message} placeholder={t('app.agent.composer.placeholder')} aria-label={t('app.agent.composer.placeholder')}
                onChange={(e) => setDraft(e.target.value)}
                onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !composing.current) { e.preventDefault(); void send(draft); } }}
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-subtle disabled:opacity-60"
                style={{ fieldSizing: 'content', outline: 'none', borderRadius: 0 } as React.CSSProperties}
              />
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()} aria-label={t('app.agent.composer.stop')} title={t('app.agent.composer.stop')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white hover:bg-black/80">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" /></svg>
                </button>
              ) : (
                <button type="submit" disabled={!ready || (!draft.trim() && attached.length === 0)} aria-label={t('app.agent.composer.send')} title={t('app.agent.composer.send')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white transition hover:bg-black/80 disabled:opacity-30">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>
                </button>
              )}
            </form>
            <p className="mt-2 text-center text-[11px] text-subtle">{t('app.agent.composer.hint')}</p>
          </div>
        </div>
      </section>

      <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-s border-line bg-surface p-4 xl:flex" aria-label={t('app.agent.history.title')}>
        <h2 className="mb-3 text-base font-semibold">{t('app.agent.history.title')}</h2>
        {historyList}
      </aside>

      {pickerOpen && (
        <MediaPicker
          onClose={() => setPickerOpen(false)} orgId={orgId} userId={userId} canWrite={canWrite} demo={demo}
          slots={AGENT_LIMITS.mediaPerMessage - attached.length} excludeIds={attached.map((m) => m.id)}
          onConfirm={(items) => setAttached((cur) => [...cur, ...items.filter((m) => !cur.some((c) => c.id === m.id)).map(toAgentMedia)].slice(0, AGENT_LIMITS.mediaPerMessage))}
        />
      )}
    </div>
  );
}
