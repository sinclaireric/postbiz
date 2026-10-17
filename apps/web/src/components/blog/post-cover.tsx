import type { CoverTheme } from '@/lib/blog/types';
import { LogoMark } from '../logo';

/**
 * Couverture d'un article, dessinée en CSS : pas d'image à produire ni à héberger pour chaque article.
 * Toutes les tailles sont en `cqw` (largeur du cadre) : la couverture se met à l'échelle de sa carte, de la vignette à la page.
 */

interface Palette {
  bg: string;
  text: string;
  line: string;
  shapes: [string, string, string];
}

const PALETTES: Record<CoverTheme, Palette> = {
  forest: { bg: 'var(--color-forest)', text: '#ffffff', line: 'rgba(198, 244, 50, 0.2)', shapes: ['#c6f432', '#ff9d4d', '#f4f3ea'] },
  lime: { bg: 'var(--color-lime)', text: '#111110', line: 'rgba(15, 61, 46, 0.18)', shapes: ['#0f3d2e', '#ffffff', '#111110'] },
  ink: { bg: 'var(--color-ink)', text: '#ffffff', line: 'rgba(255, 255, 255, 0.09)', shapes: ['#c6f432', '#ff9d4d', '#14513d'] },
};

/** Trois compositions de losanges ; l'identifiant de l'article en choisit une, toujours la même pour lui. */
const SHAPES: { x: number; y: number; size: number; color: 0 | 1 | 2 }[][] = [
  [{ x: 70, y: 17, size: 9, color: 0 }, { x: 89, y: 34, size: 7, color: 1 }, { x: 78, y: 66, size: 8, color: 2 }],
  [{ x: 60, y: 22, size: 7, color: 1 }, { x: 84, y: 18, size: 10, color: 0 }, { x: 91, y: 58, size: 6, color: 2 }],
  [{ x: 76, y: 24, size: 11, color: 2 }, { x: 92, y: 48, size: 6, color: 0 }, { x: 64, y: 62, size: 7, color: 1 }],
];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function PostCover({ title, slug, theme, className = '' }: { title: string; slug: string; theme: CoverTheme; className?: string }) {
  const p = PALETTES[theme];
  const shapes = SHAPES[hash(slug) % SHAPES.length]!;
  return (
    <div
      dir="ltr"
      aria-hidden="true"
      className={`@container relative aspect-video overflow-hidden ${className}`}
      style={{ background: p.bg, color: p.text }}
    >
      {/* Trame de losanges, qui s'efface vers le texte */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(45deg, transparent calc(50% - 0.5px), ${p.line} calc(50% - 0.5px), ${p.line} calc(50% + 0.5px), transparent calc(50% + 0.5px)), linear-gradient(-45deg, transparent calc(50% - 0.5px), ${p.line} calc(50% - 0.5px), ${p.line} calc(50% + 0.5px), transparent calc(50% + 0.5px))`,
          backgroundSize: '13cqw 13cqw',
          maskImage: 'linear-gradient(to left, #000 15%, transparent 80%)',
          WebkitMaskImage: 'linear-gradient(to left, #000 15%, transparent 80%)',
        }}
      />
      {shapes.map((s, i) => (
        <span
          key={i}
          className="absolute"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}cqw`, height: `${s.size}cqw`, borderRadius: '1.4cqw', background: p.shapes[s.color], transform: 'translate(-50%, -50%) rotate(45deg)' }}
        />
      ))}
      <div className="absolute start-[6cqw] top-[6cqw] flex items-center gap-[1.6cqw] text-[4.4cqw] font-extrabold tracking-tight">
        <LogoMark className="size-[6.2cqw]" />
        postbiz
      </div>
      <p className="absolute start-[6cqw] bottom-[6cqw] line-clamp-4 max-w-[64%] text-[8.2cqw] leading-[1.06] font-semibold tracking-[-0.03em]">{title}</p>
    </div>
  );
}
