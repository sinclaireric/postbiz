'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n/client';
import { snapToCodePoint, styleState, styleText, toggleStyle, type StyleKind, type TextStyle } from '@/lib/text/style';
import { BoldIcon, HashIcon, ImageIcon, SmileIcon, UnderlineIcon } from './composer-icons';
import { EmojiPicker } from './emoji-picker';
import { useDismiss } from './use-dismiss';

const tool = 'flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-wash hover:text-ink disabled:pointer-events-none disabled:opacity-50';
const NO_STYLE: TextStyle = { bold: false, underline: false };

/**
 * Éditeur de texte d'une publication ou d'un commentaire : gras, souligné et émojis, comme sur Postiz. C'est un champ texte ordinaire :
 * le gras et le souligné s'écrivent dans le texte (voir lib/text/style.ts), donc ce qu'on voit est ce qui sera publié.
 *
 * - avec du texte sélectionné, un clic sur G ou S le met en gras ou le souligne, ou lui retire le style s'il l'a déjà ;
 * - sans sélection, le bouton s'active et le texte tapé ensuite est stylé, jusqu'à un nouveau clic ou un déplacement du curseur.
 * Toutes les modifications passent par `insertText` du navigateur : Ctrl+Z annule aussi un gras ou un émoji.
 */
export function PostEditor({
  id, name, value, onValueChange, placeholder, rows = 9, disabled = false, label, tools, footer, className = '',
}: {
  id: string; name: string; value: string; onValueChange: (value: string) => void; placeholder?: string; rows?: number; disabled?: boolean;
  /** Nom du champ pour les lecteurs d'écran. */
  label: string;
  /** Boutons ajoutés après ceux de l'éditeur. */
  tools?: ReactNode;
  /** Zone à droite de la barre d'outils (compteurs de caractères). */
  footer?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [typing, setTyping] = useState<TextStyle>(NO_STYLE);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useDismiss(emojiOpen, () => setEmojiOpen(false));

  // Valeurs lues par les écouteurs natifs, toujours à jour sans les réinstaller.
  const live = useRef({ typing, value });
  live.current = { typing, value };
  const caretAfterTyping = useRef<number | null>(null);

  /** Remplace [start, end[ par `text` via le navigateur (annulable), puis place la sélection. */
  function replaceRange(start: number, end: number, text: string, select: boolean) {
    const el = ref.current;
    if (!el) return;
    const from = snapToCodePoint(el.value, start);
    const to = Math.max(from, snapToCodePoint(el.value, end));
    el.focus();
    el.setSelectionRange(from, to);
    let done = false;
    try {
      done = document.execCommand('insertText', false, text);
    } catch {
      done = false;
    }
    if (!done) {
      el.setRangeText(text, from, to, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const next = select ? { start: from, end: from + text.length } : { start: from + text.length, end: from + text.length };
    el.setSelectionRange(next.start, next.end);
    caretAfterTyping.current = next.start === next.end ? next.start : null;
    setSelection(next);
  }
  const replaceRef = useRef(replaceRange);
  replaceRef.current = replaceRange;

  // Frappe avec un style activé : on remplace la lettre tapée par sa version stylée, avant que le navigateur ne l'insère.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      const { typing: style } = live.current;
      if ((!style.bold && !style.underline) || e.inputType !== 'insertText' || !e.data || e.isComposing) return;
      const styled = styleText(e.data, style);
      if (styled === e.data) return;
      e.preventDefault();
      // Hors de l'évènement : tant que la saisie en cours n'est pas terminée, le navigateur diffère l'évènement « input », et React
      // remettrait l'ancienne valeur avant de l'avoir vu. La position est lue au moment de l'insertion : deux lettres tapées vite
      // arrivent dans l'ordre.
      setTimeout(() => replaceRef.current(el.selectionStart, el.selectionEnd, styled, false), 0);
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  const hasSelection = selection.start !== selection.end;
  const selected = hasSelection ? value.slice(selection.start, selection.end) : '';
  const pressed = (kind: StyleKind) => (hasSelection ? styleState(selected, kind) === 'all' : typing[kind]);

  function format(kind: StyleKind) {
    const el = ref.current;
    if (!el || disabled) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) {
      setTyping((s) => ({ ...s, [kind]: !s[kind] }));
      caretAfterTyping.current = start;
      el.focus();
      return;
    }
    replaceRange(start, end, toggleStyle(el.value.slice(start, end), kind), true);
  }

  const insert = (text: string) => {
    const el = ref.current;
    if (!el) return;
    // Après un clic dans le sélecteur d'émojis, le champ a perdu le focus : on reprend la sélection mémorisée.
    replaceRange(selection.start, selection.end, text, false);
    setEmojiOpen(false);
  };

  // Les boutons ne prennent pas le focus : le texte sélectionné reste sélectionné.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className={`rounded-2xl border border-line bg-surface focus-within:border-ink focus-within:ring-4 focus-within:ring-lime/40 ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id} name={name} ref={ref} rows={rows} value={value} disabled={disabled} dir="auto" placeholder={placeholder}
        onChange={(e) => {
          onValueChange(e.target.value);
          // Tout ce qui est tapé, effacé ou collé déplace légitimement le curseur : ce n'est pas un clic ailleurs.
          if (typing.bold || typing.underline) caretAfterTyping.current = e.target.selectionStart;
        }}
        onSelect={(e) => {
          const { selectionStart: start, selectionEnd: end } = e.currentTarget;
          setSelection({ start, end });
          // Curseur déplacé à la souris ou aux flèches : le style activé pour la frappe ne suit pas.
          if (start === end && (typing.bold || typing.underline) && caretAfterTyping.current !== null && start !== caretAfterTyping.current) setTyping(NO_STYLE);
        }}
        className="block min-h-24 w-full resize-y rounded-t-2xl bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed outline-none"
      />
      <div className="flex flex-wrap items-center gap-0.5 border-t border-line px-2.5 py-2">
        <button type="button" disabled aria-label={`${t('app.composer.media')} · ${t('app.composer.mediaSoon')}`} title={`${t('app.composer.media')} · ${t('app.composer.mediaSoon')}`} className={tool}><ImageIcon width={18} height={18} /></button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <button type="button" disabled={disabled} aria-pressed={pressed('underline')} aria-label={t('app.composer.underline')} title={t('app.composer.underline')} onMouseDown={keepFocus} onClick={() => format('underline')} className={`${tool} ${pressed('underline') ? '!bg-ink !text-white' : ''}`}><UnderlineIcon /></button>
        <button type="button" disabled={disabled} aria-pressed={pressed('bold')} aria-label={t('app.composer.bold')} title={t('app.composer.bold')} onMouseDown={keepFocus} onClick={() => format('bold')} className={`${tool} ${pressed('bold') ? '!bg-ink !text-white' : ''}`}><BoldIcon /></button>
        <div ref={emojiRef} className="relative">
          <button type="button" disabled={disabled} aria-expanded={emojiOpen} aria-label={t('app.composer.emoji')} title={t('app.composer.emoji')} onMouseDown={keepFocus} onClick={() => setEmojiOpen((o) => !o)} className={tool}><SmileIcon width={18} height={18} /></button>
          {emojiOpen && <div className="absolute start-0 top-full z-20 mt-1"><EmojiPicker onPick={insert} /></div>}
        </div>
        <button type="button" disabled={disabled} aria-label={t('app.composer.hashtag')} title={t('app.composer.hashtag')} onMouseDown={keepFocus} onClick={() => insert('#')} className={tool}><HashIcon width={18} height={18} /></button>
        {tools}
        {footer && <div className="ms-auto flex flex-wrap items-center justify-end gap-1.5 text-xs">{footer}</div>}
      </div>
    </div>
  );
}
