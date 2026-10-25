'use client';

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n/client';
import { MediaThumb } from '@/components/media/media-thumb';
import { fetchVideoJob, VIDEO_POLL_MS } from '@/lib/agent/video-client';
import type { AgentMedia, AgentVideoJob, VideoJobResponse } from '@/lib/agent/types';

/** Une vidéo lancée par l'agent, dans son état du moment : la tâche, son média une fois prête, et l'adresse signée pour la lire. */
export interface VideoJobState {
  job: AgentVideoJob;
  media: AgentMedia | null;
  url: string | null;
}

/**
 * La vidéo qu'une réponse de l'agent a lancée. Elle prend plusieurs minutes : tant qu'elle est en cours, la carte l'interroge toutes les dix secondes
 * (ce qui la fait avancer côté serveur), puis montre le lecteur et propose d'en faire une publication. Fermer la page n'interrompt rien : la vidéo
 * se range toute seule dans la médiathèque dès qu'une interrogation la trouve prête, et la conversation la retrouve à sa réouverture.
 */
export function VideoJobCard({ state, demo, canWrite, onUpdate, onUse }: {
  state: VideoJobState; demo: boolean; canWrite: boolean; onUpdate: (response: VideoJobResponse) => void; onUse: (media: AgentMedia, url: string | null) => void;
}) {
  const t = useT();
  const { job, media, url } = state;
  const pending = job.status === 'pending';
  // Une vidéo terminée qu'on rouvre n'a pas encore d'adresse signée : une seule interrogation suffit à l'obtenir.
  const needsUrl = job.status === 'completed' && job.mediaId !== null && url === null;
  const asked = useRef(false);
  const update = useRef(onUpdate);
  update.current = onUpdate;

  useEffect(() => {
    if (!pending && !(needsUrl && !asked.current)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const tick = async () => {
      if (stopped) return;
      if (document.hidden) return schedule(); // onglet en arrière-plan : on attend de le retrouver
      const response = await fetchVideoJob(job.id, controller.signal);
      if (stopped) return;
      asked.current = true;
      if (response) {
        update.current(response);
        if (response.job.status !== 'pending') return;
      }
      schedule();
    };
    const schedule = () => { timer = setTimeout(() => void tick(), VIDEO_POLL_MS); };
    const onVisible = () => {
      if (document.hidden || stopped) return;
      clearTimeout(timer);
      void tick();
    };

    timer = setTimeout(() => void tick(), pending ? 4_000 : 0);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [job.id, pending, needsUrl]);

  const vertical = job.orientation === 'vertical';
  const removed = job.status === 'completed' && job.mediaId === null;

  return (
    <section aria-label={t('app.agent.video.label')} className="mt-3 max-w-md overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <p role="status" className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
          {pending ? (
            <span className="flex shrink-0 gap-1" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
          ) : (
            <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${job.status === 'completed' && !removed ? 'bg-lime text-ink' : 'bg-danger-soft text-danger'}`}>{job.status === 'completed' && !removed ? '✓' : '!'}</span>
          )}
          <span className="truncate">{pending ? t('app.agent.video.pending') : removed ? t('app.agent.video.removed') : job.status === 'completed' ? t('app.agent.video.ready') : t('app.agent.video.failed')}</span>
        </p>
        <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-muted">{t(vertical ? 'app.agent.video.vertical' : 'app.agent.video.horizontal')}</span>
      </header>

      <div className="p-3.5">
        {pending && <p className="text-[13px] leading-relaxed text-muted">{t('app.agent.video.hint')}</p>}
        {job.status === 'failed' && job.error && <p className="text-[13px] leading-relaxed text-muted">{t('app.agent.video.reason', { reason: job.error })}</p>}

        {job.status === 'completed' && media && (
          url ? (
            <video src={url} controls playsInline preload="metadata" className={`mx-auto max-h-[420px] w-full rounded-xl bg-ink ${vertical ? 'aspect-[9/16] max-w-[236px]' : 'aspect-video'}`} />
          ) : (
            <div className={`mx-auto overflow-hidden rounded-xl ${vertical ? 'aspect-[9/16] max-w-[236px]' : 'aspect-video'}`}>
              <MediaThumb item={media} showDuration={false} />
            </div>
          )
        )}
        {job.status === 'completed' && media && !url && demo && <p className="mt-2 text-center text-xs text-subtle">{t('app.agent.video.demo')}</p>}

        {job.prompt && <p lang="en" className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-subtle">{job.prompt}</p>}

        {job.status === 'completed' && media && canWrite && (
          <button
            type="button" onClick={() => onUse(media, url)}
            className="mt-3 flex h-10 w-full items-center justify-center rounded-full bg-ink px-4 text-[13.5px] font-semibold text-white transition hover:bg-black/80"
          >{t('app.agent.video.use')}</button>
        )}
      </div>
    </section>
  );
}
