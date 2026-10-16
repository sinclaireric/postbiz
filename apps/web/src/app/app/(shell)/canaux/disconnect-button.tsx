'use client';

import { disconnectAction } from './actions';

export function DisconnectButton({ integrationId, name }: { integrationId: string; name: string }) {
  return (
    <form
      action={disconnectAction}
      onSubmit={(e) => {
        if (!window.confirm(`Déconnecter « ${name} » ? Les jetons seront supprimés et les publications en attente sur ce canal passeront en erreur.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="integrationId" value={integrationId} />
      <button type="submit" className="h-8 rounded-full border border-line px-3 text-xs font-semibold text-muted hover:border-danger hover:text-danger">Déconnecter</button>
    </form>
  );
}
