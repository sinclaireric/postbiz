'use client';

import dynamic from 'next/dynamic';
import type { Categories, EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';

// Le sélecteur de Postiz (emoji-picker-react) : recherche, catégories, teintes de peau, récents. Chargé à l'ouverture seulement : il
// embarque la liste complète des émojis. Émojis du système (« native ») : aucune image n'est téléchargée chez un tiers.
const Picker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => <div className="h-[380px] w-[320px] animate-pulse rounded-2xl bg-wash" aria-hidden="true" />,
});

const CATEGORIES: [string, MessageKey][] = [
  ['suggested', 'app.emoji.suggested'], ['smileys_people', 'app.emoji.smileys'], ['animals_nature', 'app.emoji.animals'], ['food_drink', 'app.emoji.food'],
  ['travel_places', 'app.emoji.travel'], ['activities', 'app.emoji.activities'], ['objects', 'app.emoji.objects'], ['symbols', 'app.emoji.symbols'], ['flags', 'app.emoji.flags'],
];

/** Sélecteur d'émojis : un clic sur un émoji appelle `onPick` avec le caractère. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-2xl shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)]">
      <Picker
        width={320}
        height={380}
        emojiStyle={'native' as EmojiStyle}
        theme={'light' as Theme}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
        searchPlaceholder={t('app.emoji.search')}
        searchClearButtonLabel={t('app.emoji.clear')}
        categories={CATEGORIES.map(([category, label]) => ({ category: category as Categories, name: t(label) }))}
        onEmojiClick={(e: EmojiClickData) => onPick(e.emoji)}
      />
    </div>
  );
}
