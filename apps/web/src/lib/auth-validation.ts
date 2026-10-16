export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function validateEmail(email: string): string | null {
  if (!email) return 'Saisissez votre adresse e-mail.';
  if (!EMAIL_RE.test(email) || email.length > 254) return 'Cette adresse e-mail n’est pas valide.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Saisissez un mot de passe.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (password.length > 72) return 'Le mot de passe ne peut pas dépasser 72 caractères.';
  return null;
}

/** Messages d'erreur Supabase Auth traduits, sans révéler si une adresse existe déjà. */
export function frenchAuthError(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return 'Confirmez votre adresse e-mail avec le lien que nous vous avons envoyé.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (m.includes('password should be') || m.includes('weak password')) return 'Ce mot de passe est trop faible. Choisissez-en un plus long.';
  if (m.includes('same password')) return 'Choisissez un mot de passe différent de l’ancien.';
  return 'Une erreur est survenue. Réessayez dans un instant.';
}
