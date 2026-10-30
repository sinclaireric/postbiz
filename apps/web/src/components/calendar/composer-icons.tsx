import type { SVGProps } from 'react';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
type P = SVGProps<SVGSVGElement>;

export const SparklesIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>
);
export const SmileIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>
);
export const HashIcon = (p: P) => (
  <svg {...base} {...p}><path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16" /></svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const ImageIcon = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5.5-5.5L14 17l3-3 4 4" /></svg>
);
export const ClockIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const ChevronDownIcon = (p: P) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const HeartIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 20s-7-4.4-9-9.2C1.8 7.6 3.6 5 6.4 5c1.9 0 3.4 1 4.4 2.5h.4C12.2 6 13.7 5 15.6 5c2.8 0 4.6 2.6 3.4 5.8-2 4.8-9 9.2-9 9.2Z" transform="translate(1 0)" /></svg>
);
export const CommentIcon = (p: P) => (
  <svg {...base} {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
);
export const RepostIcon = (p: P) => (
  <svg {...base} {...p}><path d="m17 3 4 4-4 4M3 11V9a2 2 0 0 1 2-2h16M7 21l-4-4 4-4M21 13v2a2 2 0 0 1-2 2H3" /></svg>
);
export const ShareIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" /></svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" /></svg>
);
export const PencilIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /></svg>
);
export const FileIcon = (p: P) => (
  <svg {...base} {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
);
export const GlobeIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" /></svg>
);
export const RefreshIcon = (p: P) => (
  <svg {...base} {...p}><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16M20 20v-4h-4" /></svg>
);

// Icônes du gras et du souligné : celles de Postiz (trait de 1,2 sur une grille de 16).
const small = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
export const BoldIcon = (p: P) => (
  <svg {...small} {...p}><path d="M4 8.00033H9.33333C10.8061 8.00033 12 6.80642 12 5.33366C12 3.8609 10.8061 2.66699 9.33333 2.66699H4V8.00033ZM4 8.00033H10C11.4728 8.00033 12.6667 9.19423 12.6667 10.667C12.6667 12.1398 11.4728 13.3337 10 13.3337H4V8.00033Z" /></svg>
);
export const UnderlineIcon = (p: P) => (
  <svg {...small} {...p}><path d="M11.9993 2.66699V7.33366C11.9993 9.5428 10.2085 11.3337 7.99935 11.3337C5.79021 11.3337 3.99935 9.5428 3.99935 7.33366V2.66699M2.66602 14.0003H13.3327" /></svg>
);
