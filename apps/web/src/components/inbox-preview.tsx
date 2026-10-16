import { NETWORKS } from '@/lib/networks';

const color = (id: string) => NETWORKS.find((n) => n.id === id)?.color ?? '#999';

const ROWS = [
  { name: 'Léa Marchand', net: 'instagram', text: 'Bonjour, vous livrez en Belgique ?', time: '2 min', unread: 2, active: true },
  { name: 'Karim B.', net: 'facebook', text: 'Merci pour la réponse, c’est parfait !', time: '14 min', unread: 0 },
  { name: 'Sarah — commentaire', net: 'instagram', text: 'Trop beau 😍 c’est dispo en vert ?', time: '1 h', unread: 1 },
  { name: 'Atelier Nord', net: 'youtube', text: 'Super vidéo, une suite est prévue ?', time: '3 h', unread: 0 },
];

/** Aperçu statique de la boîte de réception. Données fictives, uniquement illustratives. */
export function InboxPreview({ className = '' }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)] ${className}`}
      role="img"
      aria-label="Aperçu de la boîte de réception Postbiz : liste de conversations à gauche, discussion à droite."
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-wash px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-xs font-medium text-subtle">Boîte de réception</span>
      </div>
      <div className="grid grid-cols-[210px_1fr] text-[13px] max-sm:grid-cols-1">
        <ul className="border-r border-line max-sm:hidden">
          {ROWS.map((r) => (
            <li key={r.name} className={`flex gap-2.5 border-b border-line px-3 py-3 ${r.active ? 'bg-lime-soft/60' : ''}`}>
              <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wash text-xs font-bold">
                {r.name.slice(0, 1)}
                <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface" style={{ background: color(r.net) }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="shrink-0 text-[11px] text-subtle">{r.time}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted">{r.text}</span>
                  {r.unread > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">{r.unread}</span>}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex min-h-[300px] flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color('instagram') }} />
              <span className="font-semibold">Léa Marchand</span>
              <span className="text-subtle">· Instagram</span>
            </div>
            <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-[11px] font-semibold text-ok">Répondre sous 19 h</span>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 bg-paper px-4 py-4">
            <p className="max-w-[78%] rounded-2xl rounded-bl-md bg-surface px-3.5 py-2 shadow-sm ring-1 ring-line">Bonjour, vous livrez en Belgique ?</p>
            <p className="max-w-[78%] rounded-2xl rounded-bl-md bg-surface px-3.5 py-2 shadow-sm ring-1 ring-line">Et en combien de temps ? 🙏</p>
            <p className="ml-auto max-w-[78%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-white">Bonjour Léa ! Oui, livraison en 3 à 5 jours ouvrés.</p>
          </div>
          <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
            <span className="flex-1 rounded-full bg-wash px-4 py-2 text-subtle">Écrire une réponse…</span>
            <span className="rounded-full bg-lime px-4 py-2 text-xs font-bold">Envoyer</span>
          </div>
        </div>
      </div>
    </div>
  );
}
