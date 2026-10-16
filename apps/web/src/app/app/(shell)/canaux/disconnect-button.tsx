'use client';

import { useT } from '@/i18n/client';
import { disconnectAction } from './actions';

export function DisconnectButton({ integrationId, name }: { integrationId: string; name: string }) {
  const t = useT();
  return (
    <form
      action={disconnectAction}
      onSubmit={(e) => {
        if (!window.confirm(t('app.channelsPage.confirmDisconnect', { name }))) e.preventDefault();
      }}
    >
      <input type="hidden" name="integrationId" value={integrationId} />
      <button type="submit" className="h-8 rounded-full border border-line px-3 text-xs font-semibold text-muted hover:border-danger hover:text-danger">{t('app.channelsPage.disconnect')}</button>
    </form>
  );
}
