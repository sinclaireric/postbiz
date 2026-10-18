import { MAX_COMPANY_LENGTH, normalizeCompany } from './auth-validation';

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
