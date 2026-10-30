import { MAX_COMPANY_LENGTH, normalizeCompany } from './auth-validation';
import type { FormError } from './form-error';

/** Ce que le compte dit de son titulaire, lu dans les métadonnées Supabase (inscription par e-mail ou Google). */
export interface AccountIdentity {
  email: string;
  /** Nom complet renseigné par Google. */
  name?: string;
  /** Nom de l'entreprise saisi à l'inscription (même clé que sur mobile : `company`). */
  company?: string;
}

const text = (value: unknown) => (typeof value === 'string' ? normalizeCompany(value) : '');

/** Lit l'identité dans `user_metadata` : on n'en retient que du texte, borné. */
export function accountIdentity(user: { email?: string | null; user_metadata?: Record<string, unknown> }): AccountIdentity {
  const meta = user.user_metadata ?? {};
  const company = [...text(meta.company)].slice(0, MAX_COMPANY_LENGTH).join('');
  const name = text(meta.full_name) || text(meta.name);
  return { email: user.email ?? '', name: name || undefined, company: company || undefined };
}

/**
 * Nom de l'espace de travail créé à la première connexion : l'entreprise saisie, sinon « Espace de <nom> » avec le nom
 * Google ou, à défaut, le début de l'adresse e-mail. `null` laisse la base choisir son nom par défaut.
 */
export function workspaceName({ email, name, company }: AccountIdentity): string | null {
  if (company) return company;
  const person = name || email.split('@')[0] || '';
  return person ? `Espace de ${person}` : null;
}

export const MIN_WORKSPACE_NAME_LENGTH = 2;
/** Même plafond que le nom de l'organisation en base (`create_organization` tronque à 120 caractères). */
export const MAX_WORKSPACE_NAME_LENGTH = MAX_COMPANY_LENGTH;

/** Nom saisi pour un espace de travail, tel qu'on le garde : sans caractère de contrôle, espaces superflus retirés, 120 caractères au plus. */
export function cleanWorkspaceName(value: unknown): string {
  const text = normalizeCompany(String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' '));
  return [...text].slice(0, MAX_WORKSPACE_NAME_LENGTH).join('').trim();
}

/** Un nom nettoyé est-il utilisable ? Même règle que le renommage : 2 à 120 caractères. */
export function workspaceNameError(name: string): FormError | null {
  const length = [...name].length;
  return length < MIN_WORKSPACE_NAME_LENGTH || length > MAX_WORKSPACE_NAME_LENGTH ? { key: 'app.settings.errNameLength' } : null;
}
