import type { ReactNode } from 'react';

/** Liste « intitulé : valeur » d'une fiche. Une valeur `null` ou `undefined` n'affiche pas la ligne. */
export function FieldList({ items }: { items: { label: string; value: ReactNode | null | undefined }[] }) {
  return (
    <dl className="grid gap-3 text-sm">
      {items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '').map((i) => (
        <div key={i.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <dt className="text-muted">{i.label}</dt>
          <dd className="font-medium break-words">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
