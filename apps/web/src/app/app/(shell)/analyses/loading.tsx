/** Squelette affiché pendant le chargement des chiffres (première visite de la page). */
export default function AnalyticsLoading() {
  const block = 'animate-pulse rounded-3xl bg-wash';
  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-5 py-6 sm:px-8 sm:py-8" aria-busy="true">
      <div className="flex items-center justify-between gap-4">
        <div className="h-11 w-48 animate-pulse rounded-full bg-wash" />
        <div className="h-12 w-60 animate-pulse rounded-full bg-wash" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className={`${block} h-32`} />)}
      </div>
      <div className={`${block} h-80`} />
    </div>
  );
}
