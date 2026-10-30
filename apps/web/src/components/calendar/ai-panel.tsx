'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { assistAction } from '@/app/app/(shell)/calendrier/ai-actions';
import { BillingText } from '@/components/billing-text';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { AI_ACTIONS, AI_LENGTHS, AI_TONES, type AiAction, type AiErrorCode, type AiIdea, type AiLength, type AiProposal, type AiRequest, type AiResult, type AiTone } from '@/lib/ai/types';
import type { KnowledgeBrief } from '@/lib/data/types';
import type { NetworkId } from '@/lib/inbox/types';
import type { MessageKey } from '@/i18n/types';
import { maxCharsFor } from '@/lib/ai/prompt';
import { SparklesIcon } from './composer-icons';
import { KnowledgeSummary } from './knowledge-summary';

export type AiTab = 'write' | 'improve' | 'ideas' | 'knowledge';
type Tab = AiTab;
const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'write', label: 'app.ai.tabs.write' },
  { id: 'improve', label: 'app.ai.tabs.improve' },
  { id: 'ideas', label: 'app.ai.tabs.ideas' },
  { id: 'knowledge', label: 'app.ai.tabs.knowledge' },
];

const TONE_LABEL: Record<AiTone, MessageKey> = {
  professional: 'app.ai.tone.professional', friendly: 'app.ai.tone.friendly', enthusiastic: 'app.ai.tone.enthusiastic',
  inspiring: 'app.ai.tone.inspiring', humorous: 'app.ai.tone.humorous', direct: 'app.ai.tone.direct',
};
const LENGTH_LABEL: Record<AiLength, MessageKey> = { short: 'app.ai.length.short', medium: 'app.ai.length.medium', long: 'app.ai.length.long' };
const ACTION_LABEL: Record<AiAction, MessageKey> = {
  rewrite: 'app.ai.action.rewrite', shorten: 'app.ai.action.shorten', expand: 'app.ai.action.expand', fix: 'app.ai.action.fix',
  tone: 'app.ai.action.tone', hashtags: 'app.ai.action.hashtags', adapt: 'app.ai.action.adapt',
};
const ERROR_LABEL: Record<AiErrorCode, MessageKey> = {
  disabled: 'app.ai.errors.disabled', forbidden: 'app.ai.errors.forbidden', invalid: 'app.ai.errors.invalid', rate_limited: 'app.ai.errors.rate_limited',
  refused: 'app.ai.errors.refused', empty: 'app.ai.errors.empty', failed: 'app.ai.errors.failed', quota: 'app.ai.errors.quota',
};

export type ApplyMode = 'replace' | 'append';

const selectClass = 'h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-ink" />
      {children}
    </label>
  );
}

function ApplyButtons({ text, onApply }: { text: string; onApply: (text: string, mode: ApplyMode) => void }) {
  const t = useT();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => onApply(text, 'replace')}>{t('app.ai.replace')}</Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => onApply(text, 'append')}>{t('app.ai.append')}</Button>
    </div>
  );
}

function Proposal({ proposal, max, onApply }: { proposal: AiProposal; max: number; onApply: (text: string, mode: ApplyMode) => void }) {
  const t = useT();
  return (
    <li className="rounded-2xl border border-line bg-surface p-3.5">
      <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">{proposal.text}</p>
      <p className="mt-2 text-xs text-subtle">{t('app.composer.charsLimit', { count: [...proposal.text].length, max })}</p>
      <ApplyButtons text={proposal.text} onApply={onApply} />
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Idea({ idea, max, onApply }: { idea: AiIdea; max: number; onApply: (text: string, mode: ApplyMode) => void }) {
  const t = useT();
  return (
    <li className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{idea.title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${idea.origin === 'news' ? 'bg-lime-soft text-forest' : 'bg-wash text-muted'}`}>
          {idea.origin === 'news' ? t('app.ai.fromNews') : t('app.ai.fromKnowledge')}
        </span>
      </div>
      {idea.angle && <p className="mt-1 text-[13px] leading-relaxed text-muted">{idea.angle}</p>}
      <p className="mt-2.5 rounded-xl bg-paper px-3 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap">{idea.text}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-subtle">
        <span>{t('app.composer.charsLimit', { count: [...idea.text].length, max })}</span>
        {idea.source && (
          <a href={idea.source.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-ink underline underline-offset-4">
            {t('app.ai.source')} : {hostOf(idea.source.url)}
          </a>
        )}
      </p>
      <ApplyButtons text={idea.text} onApply={onApply} />
    </li>
  );
}

/**
 * Assistant IA du composeur, à la manière de Buffer : rédiger depuis un sujet, améliorer le texte en cours, proposer des idées
 * d'après l'actualité et la base de connaissance. Rien n'est publié ni inséré sans clic : chaque proposition se relit puis s'applique.
 */
export function AiPanel({ enabled, canWrite, content, networkIds, knowledge, tab, onTabChange, onApply }: {
  enabled: boolean; canWrite: boolean; content: string; networkIds: NetworkId[]; knowledge: KnowledgeBrief[]; tab: AiTab; onTabChange: (tab: AiTab) => void; onApply: (text: string, mode: ApplyMode) => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Partial<Record<Exclude<Tab, 'knowledge'>, AiResult>>>({});
  const [busy, setBusy] = useState<Tab | null>(null);

  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<AiTone>('professional');
  const [length, setLength] = useState<AiLength>('medium');
  const [useKnowledge, setUseKnowledge] = useState(knowledge.length > 0);
  const [news, setNews] = useState(true);
  const [fromKnowledge, setFromKnowledge] = useState(knowledge.length > 0);
  const [theme, setTheme] = useState('');

  const max = maxCharsFor(networkIds);
  const hasKnowledge = knowledge.length > 0;
  const text = content.trim();

  function run(key: Exclude<Tab, 'knowledge'>, req: AiRequest) {
    setBusy(key);
    setResults((r) => ({ ...r, [key]: undefined }));
    startTransition(async () => {
      let result: AiResult;
      try {
        result = await assistAction(req);
      } catch {
        result = { ok: false, error: 'failed' };
      }
      setResults((r) => ({ ...r, [key]: result }));
      setBusy(null);
    });
  }

  const knowledgeToggle = (
    <Check checked={useKnowledge && hasKnowledge} disabled={!hasKnowledge} onChange={setUseKnowledge}>
      {t('app.ai.useKnowledge', { count: knowledge.length })}
    </Check>
  );

  const renderResults = (keyName: Exclude<Tab, 'knowledge'>) => {
    const result = results[keyName];
    if (busy === keyName && pending) {
      return (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-wash px-4 py-3 text-sm text-muted">
          <SparklesIcon width={16} height={16} className="animate-pulse text-forest" />
          {keyName === 'ideas' && news ? t('app.ai.researching') : t('app.ai.generating')}
        </p>
      );
    }
    if (!result) return null;
    if (!result.ok) return <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger"><BillingText k={ERROR_LABEL[result.error]} /></p>;
    return (
      <div className="grid gap-2.5" aria-live="polite">
        <ul className="grid gap-2.5">
          {result.mode === 'ideas'
            ? result.ideas.map((idea, i) => <Idea key={i} idea={idea} max={max} onApply={onApply} />)
            : result.proposals.map((p, i) => <Proposal key={i} proposal={p} max={max} onApply={onApply} />)}
        </ul>
        {result.consulted && result.consulted.length > 0 && <p className="text-xs leading-relaxed text-subtle">{t('app.ai.consulted', { titles: result.consulted.join(', ') })}</p>}
      </div>
    );
  };

  const unavailable = !enabled && tab !== 'knowledge';
  const canRun = canWrite && enabled && !pending;

  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label={t('app.ai.title')} className="grid grid-cols-4 gap-1 rounded-full bg-wash p-1">
        {TABS.map((item) => (
          <button
            key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => onTabChange(item.id)}
            className={`rounded-full px-1 py-1.5 text-[13px] font-semibold transition ${tab === item.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {unavailable && <p role="status" className="rounded-2xl bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">{t('app.ai.unavailable')}</p>}

      {tab === 'write' && (
        <div className="grid gap-3.5">
          <Field label={t('app.ai.topicLabel')} htmlFor="ai-topic">
            <textarea
              id="ai-topic" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={600} placeholder={t('app.ai.topicPlaceholder')}
              className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('app.ai.toneLabel')} htmlFor="ai-tone">
              <select id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value as AiTone)} className={selectClass}>
                {AI_TONES.map((v) => <option key={v} value={v}>{t(TONE_LABEL[v])}</option>)}
              </select>
            </Field>
            <Field label={t('app.ai.lengthLabel')} htmlFor="ai-length">
              <select id="ai-length" value={length} onChange={(e) => setLength(e.target.value as AiLength)} className={selectClass}>
                {AI_LENGTHS.map((v) => <option key={v} value={v}>{t(LENGTH_LABEL[v])}</option>)}
              </select>
            </Field>
          </div>
          {knowledgeToggle}
          <Button type="button" disabled={!canRun || !topic.trim()} onClick={() => run('write', { mode: 'write', topic, tone, length, networkIds, useKnowledge: useKnowledge && hasKnowledge })}>
            <SparklesIcon width={16} height={16} />{t('app.ai.generate')}
          </Button>
          {renderResults('write')}
        </div>
      )}

      {tab === 'improve' && (
        <div className="grid gap-3.5">
          <p className="text-sm leading-relaxed text-muted">{text ? t('app.ai.improveIntro') : t('app.ai.improveEmpty')}</p>
          <Field label={t('app.ai.toneLabel')} htmlFor="ai-improve-tone">
            <select id="ai-improve-tone" value={tone} onChange={(e) => setTone(e.target.value as AiTone)} className={selectClass}>
              {AI_TONES.map((v) => <option key={v} value={v}>{t(TONE_LABEL[v])}</option>)}
            </select>
          </Field>
          {knowledgeToggle}
          <div className="flex flex-wrap gap-2">
            {AI_ACTIONS.map((action) => (
              <button
                key={action} type="button" disabled={!canRun || !text}
                onClick={() => run('improve', { mode: 'improve', action, text: content, tone, networkIds, useKnowledge: useKnowledge && hasKnowledge })}
                className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold transition hover:border-ink disabled:pointer-events-none disabled:opacity-50"
              >
                {t(ACTION_LABEL[action])}
              </button>
            ))}
          </div>
          {renderResults('improve')}
        </div>
      )}

      {tab === 'ideas' && (
        <div className="grid gap-3.5">
          <p className="text-sm leading-relaxed text-muted">{t('app.ai.ideasIntro')}</p>
          <div className="grid gap-2">
            <Check checked={news} onChange={setNews}>{t('app.ai.sourceNews')}</Check>
            <Check checked={fromKnowledge && hasKnowledge} disabled={!hasKnowledge} onChange={setFromKnowledge}>{t('app.ai.sourceKnowledge', { count: knowledge.length })}</Check>
          </div>
          <Field label={t('app.ai.themeLabel')} htmlFor="ai-theme">
            <input
              id="ai-theme" value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={300} placeholder={t('app.ai.themePlaceholder')}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
          </Field>
          {(() => {
            const kb = fromKnowledge && hasKnowledge;
            const needsTheme = !kb && !theme.trim();
            return (
              <>
                <Button type="button" disabled={!canRun || (!news && !kb) || needsTheme} onClick={() => run('ideas', { mode: 'ideas', theme, news, knowledge: kb, tone, networkIds })}>
                  <SparklesIcon width={16} height={16} />{t('app.ai.ideasGo')}
                </Button>
                {needsTheme && (news || kb) && <p className="-mt-1.5 text-xs text-subtle">{t('app.ai.ideasNeedTheme')}</p>}
              </>
            );
          })()}
          {renderResults('ideas')}
        </div>
      )}

      {tab === 'knowledge' && <KnowledgeSummary items={knowledge} />}

      {tab !== 'knowledge' && <p className="text-xs leading-relaxed text-subtle">{t('app.ai.privacy')} {t('app.ai.review')}</p>}
    </div>
  );
}
