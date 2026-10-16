import type { Params } from '@/i18n/translate';
import type { MessageKey, T } from '@/i18n/types';

/**
 * Une erreur destinée à l'utilisateur : une clé de message plus ses paramètres, à traduire au moment de l'afficher.
 * Les fonctions métier et les dépôts de données renvoient des FormError ; la couche d'affichage appelle `errorText`.
 */
export interface FormError {
  key: MessageKey;
  params?: Params;
}

export const errorText = (t: T, e: FormError) => t(e.key, e.params);

export const GENERIC_ERROR: FormError = { key: 'app.errors.generic' };
