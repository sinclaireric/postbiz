import type { ReactNode } from 'react';

/** Un chiffre clé : intitulé, valeur, et une précision en dessous. `tone="warn"` signale ce qui demande une action. */
export function StatTile({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <div className={`rounded-3xl border p-5 ${tone === 'warn' ? 'border-warn/30 bg-warn-soft' : 'border-line bg-surface'}`}>
      <p className={`text-sm font-medium ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className={`mt-1.5 text-xs ${tone === 'warn' ? 'text-warn' : 'text-subtle'}`}>{hint}</p>}
    </div>
  );
}
